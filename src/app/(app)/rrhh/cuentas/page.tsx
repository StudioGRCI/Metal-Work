import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { listarPersonal } from '@/lib/datos/personal'
import { palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { cambiaDatosReservados, exigirPermiso } from '@/lib/sesion'

import { EditarDatosDeCuenta } from './editar'

export const metadata = { title: 'DNI de las cuentas' }

/**
 * El DNI de cada cuenta del sistema. DKS lo decidió el 2026-10-20: lo pone y lo
 * cambia Recursos Humanos; el administrador solo lo ve, aquí y en Personal
 * (migración 20261020165000). El costo por hora de la cuenta salió de aquí el
 * 2026-10-26 (DKS): no entraba a ningún código; la mano de obra sale del costo
 * mensual de la ficha y de las horas que tarean los supervisores. La columna
 * `usuario_datos_reservados.costo_hora` se queda como estaba.
 */
export default async function PaginaDatosDeCuentas({ searchParams }: PageProps<'/rrhh/cuentas'>) {
  const perfil = await exigirPermiso('rrhh.personal')
  const cambia = cambiaDatosReservados(perfil)
  const params = await searchParams
  const busqueda = typeof params.q === 'string' && palabrasDeBusqueda(params.q).length > 0 ? params.q : undefined
  const cuentas = await listarPersonal({ busqueda, estado: 'activos' })
  const sinDni = cuentas.filter((c) => !c.documento).length

  return (
    <>
      <EncabezadoPagina
        titulo="DNI de las cuentas"
        descripcion={
          cuentas.length === 0 ? undefined : `${cuentas.length === 1 ? '1 cuenta activa' : `${cuentas.length} cuentas activas`}${sinDni > 0 ? ` · ${sinDni} sin DNI` : ''}`
        }
        ayuda={
          cambia
            ? 'Las cuentas con las que la gente entra al sistema y su DNI, que pones tú; el administrador lo ve, pero no lo cambia. El costo que se carga a cada código interno sale del costo mensual de la ficha de Personal y de las horas que tarean los supervisores, no de la cuenta.'
            : 'Las cuentas con las que la gente entra al sistema, con su DNI. Lo cambia Recursos Humanos.'
        }
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'DNI de las cuentas' }]}
      />

      <div className="mb-3 max-w-xl">
        <BuscadorSimple ruta="/rrhh/cuentas" etiqueta="Buscar cuenta" marcador="Nombre, correo o documento" />
      </div>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Persona</TH>
              <TH>DNI</TH>
              {cambia && <TH className="w-12">
                <span className="sr-only">Cambiar</span>
              </TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {cuentas.length === 0 && (
              <SinDatos
                colSpan={cambia ? 3 : 2}
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
                  </TD>
                  <TD>
                    {c.documento ? <span className="tabular text-sm text-texto">{c.documento}</span> : <span className="text-sm text-texto-suave">Sin registrar</span>}
                  </TD>
                  {cambia && (
                    <TD className="text-right">
                      <EditarDatosDeCuenta usuarioId={c.id} nombre={nombre} documento={c.documento} />
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
