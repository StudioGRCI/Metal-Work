import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { comprasDelCodigo } from '@/lib/datos/codigos-internos'
import { listarGastoPorCodigo, materialesDelCodigo } from '@/lib/datos/gasto-por-codigo'
import { enlaceGastoCodigo, faltaElPrecio, normalizarCodigo, parecidos } from '@/lib/dominio/codigos-internos'
import { situacionCompra, validacionDeCompra } from '@/lib/dominio/logistica'
import { cantidad, fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Gasto de un código interno' }

/** Lo que se gastó en un código: cada salida del almacén con su importe y cada orden de compra, aparte. */
export default async function PaginaGastoDeCodigo({ searchParams }: PageProps<'/requerimientos/gasto-por-codigo/detalle'>) {
  const perfil = await exigirPermiso('codigos_internos.gasto')
  const params = await searchParams
  const codigo = typeof params.codigo === 'string' ? normalizarCodigo(params.codigo) : ''
  if (!codigo) notFound()

  const todos = await listarGastoPorCodigo()
  const resumen = todos.find((c) => c.codigo === codigo)
  const otros = parecidos(todos.map((c) => c.codigo)).get(codigo) ?? []
  const sugeridos = resumen ? [] : (parecidos([...todos.map((c) => c.codigo), codigo]).get(codigo) ?? [])

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="font-mono break-all">{codigo}</span>}
        ayuda="Lo que salió del almacén para este código y lo que se compró con él. Sin la mano de obra."
        migas={[
          { titulo: 'Requerimientos', ruta: '/requerimientos' },
          { titulo: 'Gasto por código', ruta: '/requerimientos/gasto-por-codigo' },
          { titulo: codigo },
        ]}
      />

      {!resumen ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">Este código no tiene gasto ni requerimientos</p>
            <p className="text-sm text-texto-suave">Ninguna salida del almacén, orden de compra ni requerimiento lo lleva.</p>
            {sugeridos.length > 0 && (
              <p className="mt-2 text-sm text-texto">
                Se parece a{' '}
                {sugeridos.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ', '}
                    <Link href={enlaceGastoCodigo(s)} className="font-mono text-acento hover:underline">
                      {s}
                    </Link>
                  </span>
                ))}
                .
              </p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="space-y-5">
          {otros.length > 0 && (
            <Tarjeta className="border-aviso">
              <TarjetaCuerpo className="text-sm">
                <p className="font-medium text-texto">¿Es el mismo código que {otros.length === 1 ? 'este' : 'estos'}?</p>
                <p className="text-texto-suave">
                  Se escribe casi igual que{' '}
                  {otros.map((o, i) => (
                    <span key={o}>
                      {i > 0 && ', '}
                      <Link href={enlaceGastoCodigo(o)} className="font-mono text-acento hover:underline">
                        {o}
                      </Link>
                    </span>
                  ))}
                  . Si es el mismo, cada uno lleva su parte del gasto por separado: hay que pedir que se corrija donde se escribió.
                </p>
              </TarjetaCuerpo>
            </Tarjeta>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Indicador
              titulo="Materiales"
              valor={
                faltaElPrecio(resumen.materiales_pen + resumen.materiales_usd, resumen.materiales_sin_precio) ?? (
                  <>
                    {moneda(resumen.materiales_pen)}
                    {resumen.materiales_usd > 0 && <span className="block text-sm">+ {moneda(resumen.materiales_usd, 'USD')}</span>}
                  </>
                )
              }
              tono={resumen.materiales_sin_precio > 0 ? 'aviso' : 'neutro'}
              pie={`${resumen.salidas} ${resumen.salidas === 1 ? 'salida' : 'salidas'} del almacén${resumen.materiales_sin_precio > 0 ? ` · ${resumen.materiales_sin_precio} sin precio` : ''}`}
            />
            <Indicador
              titulo="Compras, aparte"
              valor={
                <>
                  {moneda(resumen.compras_pen)}
                  {resumen.compras_usd > 0 && <span className="block text-sm">+ {moneda(resumen.compras_usd, 'USD')}</span>}
                </>
              }
              tono={resumen.compras_sin_precio > 0 ? 'aviso' : 'neutro'}
              pie={`${resumen.compras} ${resumen.compras === 1 ? 'OC' : 'OC'} sin IGV · no se suman`}
            />
            <Indicador
              titulo="Requerimientos"
              valor={resumen.requerimientos}
              pie={resumen.requerimientos === 1 ? 'RQ vivo con este código' : 'RQ vivos con este código'}
            />
          </div>

          <Materiales codigo={codigo} />
          <Compras codigo={codigo} abrePdf={puede(perfil, ['compras.ver', 'almacen.recibir'])} />
        </div>
      )}
    </>
  )
}

async function Materiales({ codigo }: { codigo: string }) {
  const lineas = await materialesDelCodigo(codigo)
  const suma = (m: 'PEN' | 'USD') => lineas.reduce((n, l) => n + (l.moneda === m ? (l.monto ?? 0) : 0), 0)
  const sinPrecio = lineas.filter((l) => l.fuente === 'MATERIALES_SIN_PRECIO').length
  return (
    <Tarjeta className="overflow-hidden">
      <TarjetaCabecera
        titulo="Materiales salidos del almacén"
        ayuda="Cada salida para este código, con lo que vale. Lo que todavía no tiene precio sale «Sin precio» y no se suma como cero."
      />
      <Tabla>
        <TablaCabecera>
          <tr>
            <TH>Fecha</TH>
            <TH>Material</TH>
            <TH className="text-right">Cantidad</TH>
            <TH className="text-right">Importe</TH>
          </tr>
        </TablaCabecera>
        <tbody>
          {lineas.length === 0 ? (
            <SinDatos titulo="Ninguna salida del almacén para este código" descripcion="Almacén las registra con el código de la unidad o por su requerimiento." />
          ) : (
            <>
              {lineas.map((l, i) => (
                <TR key={`${l.referencia_id ?? ''}-${l.documento ?? ''}-${i}`}>
                  <TD className="tabular align-top whitespace-nowrap">{fecha(l.fecha)}</TD>
                  <TD className="align-top">
                    <p className="text-texto">{l.concepto}</p>
                    <p className="text-xs text-texto-suave">{[l.documento, l.detalle].filter(Boolean).join(' · ')}</p>
                  </TD>
                  <TD className="tabular text-right align-top whitespace-nowrap">
                    {cantidad(l.cantidad)} {l.unidad}
                  </TD>
                  <TD className="tabular text-right align-top">
                    {l.fuente === 'MATERIALES_SIN_PRECIO' ? <Insignia tono="aviso">Sin precio</Insignia> : moneda(l.monto, l.moneda ?? 'PEN')}
                  </TD>
                </TR>
              ))}
              <TR className="font-semibold">
                <TD colSpan={3}>Total</TD>
                <TD className="tabular text-right">
                  {faltaElPrecio(suma('PEN') + suma('USD'), sinPrecio) ?? moneda(suma('PEN'))}
                  {suma('USD') > 0 && <p>+ {moneda(suma('USD'), 'USD')}</p>}
                </TD>
              </TR>
            </>
          )}
        </tbody>
      </Tabla>
    </Tarjeta>
  )
}

async function Compras({ codigo, abrePdf }: { codigo: string; abrePdf: boolean }) {
  const compras = await comprasDelCodigo(codigo)
  return (
    <Tarjeta className="overflow-hidden">
      <TarjetaCabecera
        titulo="Compras con este código"
        ayuda="Las órdenes de compra sin IGV, menos las rechazadas. No se suman al gasto: lo comprado entra al almacén y se cuenta cuando sale para este código."
      />
      <Tabla>
        <TablaCabecera>
          <tr>
            <TH>OC</TH>
            <TH className="hidden sm:table-cell">Proveedor</TH>
            <TH>En qué va</TH>
            <TH className="text-right">Importe</TH>
          </tr>
        </TablaCabecera>
        <tbody>
          {compras.length === 0 ? (
            <SinDatos titulo="Ninguna compra con este código" descripcion="Logística pone el código en la OC al comprar para una unidad." />
          ) : (
            compras.map((oc) => {
              const situacion = situacionCompra({ ...oc, validacion: validacionDeCompra(oc.validaciones) })
              const numero = oc.numero ?? 'OC sin número'
              return (
                <TR key={oc.id} data-compra={oc.id}>
                  <TD className="align-top">
                    {abrePdf ? (
                      <a href={`/compras/${oc.id}/pdf`} className="font-medium text-acento hover:underline" target="_blank" rel="noopener">
                        {numero}
                      </a>
                    ) : (
                      <p className="font-medium text-texto">{numero}</p>
                    )}
                    <p className="text-xs text-texto-suave">
                      {fecha(oc.fecha)}
                      {oc.requerimientos && ` · ${oc.requerimientos}`}
                    </p>
                    <p className="text-xs text-texto sm:hidden">{oc.proveedor}</p>
                  </TD>
                  <TD className="hidden align-top sm:table-cell">{oc.proveedor}</TD>
                  <TD className="align-top">
                    <Insignia tono={situacion.tono}>{situacion.etiqueta}</Insignia>
                  </TD>
                  <TD className="tabular text-right align-top">
                    {moneda(oc.monto, oc.moneda)}
                    {oc.sin_precio > 0 && (
                      <p className="text-xs text-aviso">
                        {oc.sin_precio} de {oc.lineas} {oc.lineas === 1 ? 'línea' : 'líneas'} sin precio
                      </p>
                    )}
                  </TD>
                </TR>
              )
            })
          )}
        </tbody>
      </Tabla>
    </Tarjeta>
  )
}
