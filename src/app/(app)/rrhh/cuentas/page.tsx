import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { listarPersonal } from '@/lib/datos/personal'
import { palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { moneda } from '@/lib/format'
import { cambiaDatosReservados, exigirPermiso, puede } from '@/lib/sesion'

import { EditarDatosDeCuenta } from './editar'

export const metadata = { title: 'DNI y costo de las cuentas' }

/**
 * El DNI y el costo por hora de cada cuenta del sistema. DKS lo decidió el
 * 2026-10-20: los pone y los cambia Recursos Humanos; el administrador solo los
 * ve, aquí y en Personal (migración 20261020165000).
 */
export default async function PaginaDatosDeCuentas({ searchParams }: PageProps<'/rrhh/cuentas'>) {
  const perfil = await exigirPermiso('rrhh.personal')
  const cambia = cambiaDatosReservados(perfil)
  const planillas = puede(perfil, 'rrhh.ver_planillas')
  const params = await searchParams
  const busqueda = typeof params.q === 'string' && palabrasDeBusqueda(params.q).length > 0 ? params.q : undefined
  const cuentas = await listarPersonal({ busqueda, estado: 'activos' })
  const sinDni = cuentas.filter((c) => !c.documento).length

  return (
    <>
      <EncabezadoPagina
        titulo="DNI y costo de las cuentas"
        descripcion={`${
          cuentas.length === 0 ? '' : `${cuentas.length === 1 ? '1 cuenta activa' : `${cuentas.length} cuentas activas`}${sinDni > 0 ? ` · ${sinDni} sin DNI` : ''}. `
        }El costo por hora va solo en las cuentas de operario; el costo que se carga a cada código interno sale del costo mensual de la ficha del personal.`}
        ayuda={
          cambia
            ? 'Las cuentas con las que la gente entra al sistema. Su DNI y su costo por hora los pones tú; el administrador los ve, pero no los cambia. El costo que se carga a cada código interno sale de la ficha de Personal, no de aquí.'
            : 'Las cuentas con las que la gente entra al sistema, con su DNI y su costo por hora. Los cambia Recursos Humanos.'
        }
        migas={[{ titulo: 'Recursos Humanos', ruta: planillas ? '/rrhh' : undefined }, { titulo: 'DNI y costo de las cuentas' }]}
      />

      <div className="mb-3 max-w-xl">
        <BuscadorSimple ruta="/rrhh/cuentas" etiqueta="Buscar cuenta" marcador="Nombre, correo o documento" />
      </div>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Persona</TH>
              <TH className="hidden sm:table-cell">DNI</TH>
              <TH className="text-right">Costo hora</TH>
              {cambia && <TH className="w-12">
                <span className="sr-only">Cambiar</span>
              </TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {cuentas.length === 0 && (
              <SinDatos
                colSpan={cambia ? 4 : 3}
                titulo={busqueda ? `Nadie con «${busqueda}»` : 'No hay cuentas activas'}
                descripcion={busqueda ? 'Prueba con el apellido o con el correo.' : 'Las cuentas las crea el administrador en Personal.'}
              />
            )}
            {cuentas.map((c) => {
              const nombre = `${c.nombres} ${c.apellidos}`
              return (
                <TR key={c.id} data-cuenta={c.correo}>
                  <TD>
                    <p className="font-medium text-texto">
                      {c.apellidos}, {c.nombres}
                    </p>
                    <p className="text-xs text-texto-suave">
                      {c.rol?.nombre ?? 'Sin puesto'}
                      {c.cargo && ` · ${c.cargo}`}
                    </p>
                    <p className="tabular text-xs text-texto-suave sm:hidden">DNI {c.documento ?? 'sin registrar'}</p>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    {c.documento ? <span className="tabular text-sm text-texto">{c.documento}</span> : <span className="text-sm text-texto-suave">Sin registrar</span>}
                  </TD>
                  <TD className="text-right">
                    {c.es_operario || c.costo_hora > 0 ? (
                      <span className="tabular text-sm text-texto">{c.costo_hora > 0 ? moneda(c.costo_hora) : 'Sin registrar'}</span>
                    ) : (
                      <span className="text-sm text-texto-suave">—</span>
                    )}
                  </TD>
                  {cambia && (
                    <TD className="text-right">
                      <EditarDatosDeCuenta
                        usuarioId={c.id}
                        nombre={nombre}
                        documento={c.documento}
                        costoHora={c.costo_hora}
                        conCosto={c.es_operario || c.costo_hora > 0}
                      />
                    </TD>
                  )}
                </TR>
              )
            })}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
