import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { listarProveedores, PROVEEDORES_POR_PAGINA } from '@/lib/datos/proveedores'
import { palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { condicionDePago, resumenCuenta } from '@/lib/dominio/proveedores'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AccionesProveedor, NuevoProveedor } from './formulario'

export const metadata = { title: 'Proveedores' }

export default async function PaginaProveedores({ searchParams }: PageProps<'/proveedores'>) {
  const perfil = await exigirPermiso('proveedores.ver')
  const params = await searchParams

  // Solo signos («%») no es una búsqueda, como en Clientes.
  const busqueda = typeof params.q === 'string' && palabrasDeBusqueda(params.q).length > 0 ? params.q : undefined
  const incluirInactivos = params.estado === 'inactivos'
  const { proveedores, total, pagina, paginas } = await listarProveedores({
    busqueda,
    pagina: Number(params.pagina) || 1,
    incluirInactivos,
  })
  const edita = puede(perfil, 'proveedores.editar')
  const verCuentas = puede(perfil, 'proveedores.ver_cuentas')

  return (
    <>
      <EncabezadoPagina
        titulo="Proveedores"
        descripcion={busqueda && total > 0
          ? `${total === 1 ? '1 proveedor' : `${total} proveedores`} con «${busqueda}»`
          : total === 1 ? '1 proveedor en el padrón' : `${total} proveedores en el padrón`}
        ayuda="La orden de compra elige el proveedor de este padrón."
        acciones={
          <div className="flex flex-wrap items-center gap-3">
            {edita && <NuevoProveedor />}
            <Link
              href={incluirInactivos ? '/proveedores' : '/proveedores?estado=inactivos'}
              className="text-sm text-acento hover:underline"
            >
              {incluirInactivos ? 'Ver solo activos' : 'Ver también los dados de baja'}
            </Link>
          </div>
        }
      />

      <BuscadorSimple ruta="/proveedores" etiqueta="Buscar proveedores" marcador="Razón social, RUC o rubro" />

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Proveedor</TH>
              <TH className="hidden sm:table-cell">Documento</TH>
              {/* En el teléfono, contacto y pago bajan a la celda del nombre: así
                  caben el RUC y Editar sin correr la tabla de lado. */}
              <TH className="hidden sm:table-cell">Contacto</TH>
              <TH className="hidden sm:table-cell">Pago</TH>
              {verCuentas && <TH className="hidden lg:table-cell">Cuentas</TH>}
              {edita && <TH>Acciones</TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {proveedores.length === 0 ? (
              <SinDatos
                colSpan={4 + (edita ? 1 : 0) + (verCuentas ? 1 : 0)}
                titulo={busqueda ? 'Ningún proveedor coincide' : 'Aún no hay proveedores en el padrón'}
                descripcion={
                  busqueda
                    ? `Nada con «${busqueda}». Prueba con el RUC o con una parte del nombre.`
                    : edita
                      ? 'Registra a quienes les compran: la orden de compra ya no se escribe a mano.'
                      : 'Logística los registra al hacer sus órdenes de compra.'
                }
              />
            ) : (
              proveedores.map((p) => {
                const contacto = [p.contacto, p.telefono].filter(Boolean).join(' · ')
                const pago = condicionDePago(p.condicion_pago, p.dias_credito)
                return (
                  <TR key={p.id}>
                    <TD>
                      <p className="font-medium text-texto">
                        {p.razon_social}
                        {!p.activo && (
                          <Insignia tono="neutro" className="ml-2">
                            Dado de baja
                          </Insignia>
                        )}
                      </p>
                      {(p.nombre_comercial || p.rubro) && (
                        <p className="text-[11px] text-texto-suave">{[p.nombre_comercial, p.rubro].filter(Boolean).join(' · ')}</p>
                      )}
                      {/* En el teléfono el RUC baja aquí: su columna aparte dejaba el nombre en cuatro renglones. */}
                      <p className="text-xs text-texto-suave sm:hidden">
                        {[`${p.tipo_documento} ${p.numero_documento}`, pago, contacto].filter(Boolean).join(' · ')}
                      </p>
                    </TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">
                      <span className="text-texto-suave">{p.tipo_documento} </span><span className="tabular">{p.numero_documento}</span>
                    </TD>
                    <TD className="hidden text-texto-suave sm:table-cell">
                      {contacto || '—'}
                      {p.correo && <p className="text-[11px]">{p.correo}</p>}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-texto-suave sm:table-cell">{pago}</TD>
                    {verCuentas && (
                      <TD className="hidden text-texto-suave lg:table-cell">
                        {p.cuentas.length === 0 ? (
                          <span className="text-aviso">Sin cuenta</span>
                        ) : (
                          p.cuentas.map((c) => (
                            <p key={c.id} className="tabular whitespace-nowrap text-[11px]">
                              {resumenCuenta(c)}
                            </p>
                          ))
                        )}
                        {p.direccion_recojo && <p className="text-[11px]">Recojo: {p.direccion_recojo}</p>}
                      </TD>
                    )}
                    {edita && (
                      <TD>
                        <AccionesProveedor proveedor={p} cuentasVisibles={verCuentas} />
                      </TD>
                    )}
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Paginacion
        ruta="/proveedores"
        pagina={pagina}
        paginas={paginas}
        total={total}
        porPagina={PROVEEDORES_POR_PAGINA}
        params={params}
      />
    </>
  )
}
