import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { NuevoProveedor } from '@/components/proveedores/nuevo-proveedor'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { listarProveedores } from '@/lib/datos/almacen-operativo'
import { CONDICION_PAGO } from '@/lib/dominio/estados'
import { exigirPermiso, puede } from '@/lib/sesion'

import { SubNavegacionAlmacen } from '../sub-navegacion'

export const metadata = { title: 'Proveedores' }

// El teléfono se marca desde el teléfono: `tel:` abre el marcador con el número
// puesto. Se le quitan espacios y guiones porque algunos marcadores los toman
// como dígitos y sale un número que no existe.
function paraMarcar(telefono: string) {
  return telefono.replace(/[\s.()-]/g, '')
}

export default async function PaginaProveedores() {
  const perfil = await exigirPermiso('compras.ver')
  const proveedores = await listarProveedores()
  const daDeAlta = puede(perfil, ['compras.crear', 'almacen.maestros', 'costos.editar'])

  return (
    <>
      <EncabezadoPagina
        titulo="Proveedores"
        descripcion="Empresas que abastecen material y servicios al taller."
        acciones={daDeAlta && <NuevoProveedor />}
      />

      <SubNavegacionAlmacen activa="/almacen/proveedores" />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Proveedor</TH>
              <TH className="hidden sm:table-cell">RUC</TH>
              <TH>Contacto</TH>
              <TH className="hidden sm:table-cell">Condición de pago</TH>
              <TH className="hidden text-right sm:table-cell">Calificación</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {proveedores.length === 0 ? (
              <SinDatos
                colSpan={5}
                titulo="Sin proveedores"
                descripcion="Con el RUC y la razón social alcanza para darlo de alta; lo demás se completa después."
                /* El botón, acá mismo: mandar a buscarlo «arriba» es un paso de
                   más, y en el teléfono ese arriba ni siquiera está a la vista. */
                accion={daDeAlta ? <NuevoProveedor /> : undefined}
              />
            ) : (
              proveedores.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium">
                    {p.razon_social}
                    {/* En el teléfono el RUC y la condición de pago pierden su
                        columna: bajan acá, que es donde se los busca. */}
                    <p className="tabular text-[11px] font-normal text-texto-suave sm:hidden">
                      {p.numero_documento}
                      {p.condicion_pago
                        ? ` · ${CONDICION_PAGO[p.condicion_pago] ?? p.condicion_pago}`
                        : ''}
                    </p>
                  </TD>
                  <TD className="tabular hidden whitespace-nowrap sm:table-cell">
                    {p.numero_documento}
                  </TD>
                  <TD className="text-texto-suave">
                    {p.contacto_nombre ?? '—'}
                    {(p.telefono || p.correo) && (
                      <p className="flex flex-wrap items-center gap-x-1 text-[11px]">
                        {p.telefono && (
                          // Alto de dedo en el teléfono y nada en el monitor: el
                          // color no cambia para que el enlace no se note ahí.
                          <a
                            href={`tel:${paraMarcar(p.telefono)}`}
                            className="inline-flex min-h-11 items-center hover:underline sm:min-h-0"
                          >
                            {p.telefono}
                          </a>
                        )}
                        {p.telefono && p.correo && <span aria-hidden>·</span>}
                        {p.correo && (
                          <a
                            href={`mailto:${p.correo}`}
                            className="inline-flex min-h-11 items-center break-all hover:underline sm:min-h-0"
                          >
                            {p.correo}
                          </a>
                        )}
                      </p>
                    )}
                  </TD>
                  <TD className="hidden text-texto-suave sm:table-cell">
                    {p.condicion_pago ? (CONDICION_PAGO[p.condicion_pago] ?? p.condicion_pago) : '—'}
                  </TD>
                  <TD className="tabular hidden text-right sm:table-cell">
                    {p.calificacion === null ? '—' : `${p.calificacion} / 5`}
                  </TD>
                </TR>
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
