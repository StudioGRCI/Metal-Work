import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { AccionesDeFila, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cumplimientoDeProveedores, listarProveedores, PROVEEDORES_POR_PAGINA } from '@/lib/datos/proveedores'
import { palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { condicionDePago, resumenCuenta } from '@/lib/dominio/proveedores'
import { exigirPermiso, puede } from '@/lib/sesion'

import { Cumplimiento } from './cumplimiento'
import { AccionesProveedor, NuevoProveedor } from './formulario'
import { paginaPedida } from '@/lib/dominio/paginas'

export const metadata = { title: 'Proveedores' }

export default async function PaginaProveedores({ searchParams }: PageProps<'/proveedores'>) {
  const perfil = await exigirPermiso('proveedores.ver')
  const params = await searchParams

  // Solo signos («%») no es una búsqueda, como en Clientes.
  const busqueda = typeof params.q === 'string' && palabrasDeBusqueda(params.q).length > 0 ? params.q : undefined
  const incluirInactivos = params.estado === 'inactivos'
  // El otro listado, con el mismo término.
  const verOtros = new URLSearchParams({
    ...(typeof params.q === 'string' && params.q ? { q: params.q } : {}),
    ...(incluirInactivos ? {} : { estado: 'inactivos' }),
  }).toString()
  const { proveedores, total, pagina, paginas } = await listarProveedores({
    busqueda,
    pagina: paginaPedida(params.pagina),
    incluirInactivos,
  })
  // Cómo le fue a cada uno (Plan 4.3). Si la base no contesta, el padrón sale igual y lo dice.
  const cumplimiento = await cumplimientoDeProveedores(proveedores.map((p) => p.id)).catch((e: unknown) => {
    console.error(e)
    return null
  })
  const edita = puede(perfil, 'proveedores.editar')
  const verCuentas = puede(perfil, 'proveedores.ver_cuentas')

  return (
    <>
      <EncabezadoPagina
        titulo="Proveedores"
        descripcion={busqueda
          ? total === 0 ? `Ningún proveedor con «${busqueda}»` : `${total === 1 ? '1 proveedor' : `${total} proveedores`} con «${busqueda}»`
          : total === 1 ? '1 proveedor en el padrón' : `${total} proveedores en el padrón`}
        ayuda="La orden de compra elige el proveedor de este padrón. «Cumplimiento» cuenta las OC y OS aprobadas que se le hicieron; de las que llegaron (la OS, cuando volvió conforme), cuántas llegaron a más tardar en la fecha que prometió al emitirlas (no la corregida después); cuántas pasaron esa fecha sin llegar completas, y de cuántas OC Almacén le devolvió algo. La que se atrasó por el pago, el transporte o la aprobación, según el último motivo que anotó Logística (también si lo cambió después de que llegó), no cuenta contra el proveedor y se dice aparte; si con ese motivo se corrigió la fecha y tampoco la cumplió, sí cuenta."
        acciones={
          <div className="flex flex-wrap items-center gap-3">
            {edita && <NuevoProveedor />}
            <Link
              href={`/proveedores${verOtros ? `?${verOtros}` : ''}`}
              // Se lleva lo que se está escribiendo, como una pastilla.
              data-filtro=""
              className="text-sm text-acento hover:underline"
            >
              {incluirInactivos ? 'Ver solo activos' : 'Ver también los dados de baja'}
            </Link>
          </div>
        }
      />

      {/* 20 px entre el buscador y la lista, como entre bloques (la escala de la skill diseno). */}
      <div className="space-y-5">
      <BuscadorSimple ruta="/proveedores" etiqueta="Buscar proveedores" marcador="Razón social, RUC o rubro" />

      {cumplimiento === null && proveedores.length > 0 && (
        <p role="status" className="text-sm text-aviso">
          No se pudo leer el cumplimiento de los proveedores: el padrón sale sin él. Recarga la página; si continúa, avisa al
          administrador.
        </p>
      )}

      {/* En el teléfono cada proveedor es una ficha con «Editar» y «Dar de baja»
          en un renglón (entrega 4 del plan de orden y diseño): en su columna
          angosta iban uno debajo del otro. */}
      <Tarjeta className="overflow-hidden">
        <Tabla apilada>
          <TablaCabecera>
            <tr>
              <TH>Proveedor</TH>
              <TH className="hidden md:table-cell">Documento</TH>
              {/* En el teléfono, contacto y pago bajan a la celda del nombre: así
                  caben el RUC y Editar sin correr la tabla de lado. */}
              {/* Contacto, cumplimiento y cuentas desde 1280 px: entre 768 y 1279 (una
                  laptop con el zoom de Windows) la tabla se salía de costado. Hasta
                  ahí, bajan a la celda del nombre. */}
              <TH className="hidden xl:table-cell">Contacto</TH>
              <TH className="hidden md:table-cell">Pago</TH>
              <TH className="hidden xl:table-cell">Cumplimiento</TH>
              {verCuentas && <TH className="hidden xl:table-cell">Cuentas</TH>}
              {edita && <TH className="md:w-56">Acciones</TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {proveedores.length === 0 ? (
              <SinDatos
                colSpan={5 + (edita ? 1 : 0) + (verCuentas ? 1 : 0)}
                titulo={busqueda ? 'Ningún proveedor coincide' : 'Aún no hay proveedores en el padrón'}
                descripcion={
                  busqueda
                    ? 'Prueba con menos palabras, con el RUC o con una parte del nombre.'
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
                  <TR key={p.id} data-proveedor={p.id}>
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
                        <p className="text-xs text-texto-suave">{[p.nombre_comercial, p.rubro].filter(Boolean).join(' · ')}</p>
                      )}
                      {/* En el teléfono el RUC baja aquí: su columna aparte dejaba el nombre en cuatro renglones. */}
                      <p className="text-xs text-texto-suave md:hidden">
                        {[`${p.tipo_documento} ${p.numero_documento}`, pago].join(' · ')}
                      </p>
                      {(contacto || p.correo) && (
                        <p className="text-xs text-texto-suave xl:hidden">{[contacto, p.correo].filter(Boolean).join(' · ')}</p>
                      )}
                      {/* Lo mismo que la columna «Cuentas», que no se ve hasta 1280 px. */}
                      {verCuentas && (
                        <div className="mt-1 text-xs text-texto-suave xl:hidden" data-cuentas-en-ficha>
                          {p.cuentas.length === 0 ? (
                            <p className="text-aviso">Sin cuenta</p>
                          ) : (
                            p.cuentas.map((c) => (
                              <p key={c.id} className="tabular">
                                {resumenCuenta(c)}
                              </p>
                            ))
                          )}
                          {p.direccion_recojo && <p>Recojo: {p.direccion_recojo}</p>}
                        </div>
                      )}
                      {/* Hasta que cabe su columna (1 280 px), el cumplimiento va aquí, en un renglón. */}
                      {cumplimiento && <Cumplimiento datos={cumplimiento.get(p.id)} enLinea className="mt-1 xl:hidden" />}
                    </TD>
                    <TD className="hidden whitespace-nowrap md:table-cell">
                      <span className="text-texto-suave">{p.tipo_documento} </span><span className="tabular">{p.numero_documento}</span>
                    </TD>
                    <TD className="hidden text-texto-suave xl:table-cell">
                      {contacto || '—'}
                      {p.correo && <p className="text-xs">{p.correo}</p>}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-texto-suave md:table-cell">{pago}</TD>
                    <TD className="hidden xl:table-cell">
                      {cumplimiento ? <Cumplimiento datos={cumplimiento.get(p.id)} /> : <span className="text-texto-tenue">—</span>}
                    </TD>
                    {verCuentas && (
                      <TD className="hidden text-texto-suave xl:table-cell">
                        {p.cuentas.length === 0 ? (
                          <span className="text-aviso">Sin cuenta</span>
                        ) : (
                          p.cuentas.map((c) => (
                            <p key={c.id} className="tabular whitespace-nowrap text-xs">
                              {resumenCuenta(c)}
                            </p>
                          ))
                        )}
                        {p.direccion_recojo && <p className="text-xs">Recojo: {p.direccion_recojo}</p>}
                      </TD>
                    )}
                    {edita && (
                      <TD>
                        <AccionesDeFila className="md:justify-start">
                          <AccionesProveedor proveedor={p} cuentasVisibles={verCuentas} />
                        </AccionesDeFila>
                      </TD>
                    )}
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
      </div>

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
