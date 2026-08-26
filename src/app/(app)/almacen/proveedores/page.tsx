import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { NuevoProveedor } from '@/components/proveedores/nuevo-proveedor'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { listarProveedores } from '@/lib/datos/almacen-operativo'
import { CONDICION_PAGO } from '@/lib/dominio/estados'
import { exigirPermiso, puede } from '@/lib/sesion'

import { SubNavegacionAlmacen } from '../sub-navegacion'

export const metadata = { title: 'Proveedores' }

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
              <TH>RUC</TH>
              <TH>Contacto</TH>
              <TH>Condición de pago</TH>
              <TH className="text-right">Calificación</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {proveedores.length === 0 ? (
              <SinDatos
                colSpan={5}
                titulo="Sin proveedores"
                descripcion="Da de alta el primero con el botón de arriba."
              />
            ) : (
              proveedores.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium">{p.razon_social}</TD>
                  <TD className="tabular whitespace-nowrap">{p.numero_documento}</TD>
                  <TD className="text-texto-suave">
                    {p.contacto_nombre ?? '—'}
                    {(p.telefono || p.correo) && (
                      <p className="text-[11px]">
                        {[p.telefono, p.correo].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </TD>
                  <TD className="text-texto-suave">
                    {p.condicion_pago ? (CONDICION_PAGO[p.condicion_pago] ?? p.condicion_pago) : '—'}
                  </TD>
                  <TD className="tabular text-right">
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
