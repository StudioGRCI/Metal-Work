import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  avanceDelCodigo,
  comprasDelCodigo,
  costeoDelCodigo,
  documentosDelCodigo,
  listarCodigosInternos,
  personalDelCodigo,
  type ResumenCodigo,
} from '@/lib/datos/codigos-internos'
import {
  ESTADO_DOCUMENTO_CODIGO,
  TIPO_DOCUMENTO_CODIGO,
  VISTAS_CODIGO,
  costoDelCodigo,
  dondeAparece,
  enlaceCodigo,
  faltaElPrecio,
  normalizarCodigo,
  parecidos,
  ultimoAvancePorTrabajo,
  vistaValida,
  type VistaCodigo,
} from '@/lib/dominio/codigos-internos'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { situacionCompra, validacionDeCompra } from '@/lib/dominio/logistica'
import { ESTADO_REPORTE, type EstadoReporte } from '@/lib/dominio/reporte-diario'
import { ESTADO_REQUERIMIENTO } from '@/lib/dominio/requerimientos'
import { horasCortas } from '@/lib/dominio/rrhh'
import { cantidad, fecha, fechaLarga, moneda } from '@/lib/format'
import { exigirPermiso, puede, type PerfilSesion } from '@/lib/sesion'

export const metadata = { title: 'Código interno' }

export default async function PaginaCodigoInterno({ searchParams }: PageProps<'/codigos-internos/detalle'>) {
  const perfil = await exigirPermiso('codigos_internos.ver')
  const params = await searchParams
  const codigo = typeof params.codigo === 'string' ? normalizarCodigo(params.codigo) : ''
  if (!codigo) notFound()
  const vista = vistaValida(params.vista)

  const todos = await listarCodigosInternos()
  const resumen = todos.find((c) => c.codigo === codigo)
  const otros = parecidos(todos.map((c) => c.codigo)).get(codigo) ?? []
  // Un código que no está en el sistema puede ser uno mal escrito: se ofrecen los parecidos.
  const sugeridos = resumen ? [] : (parecidos([...todos.map((c) => c.codigo), codigo]).get(codigo) ?? [])

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="font-mono break-all">{codigo}</span>}
        descripcion={resumen ? `Aparece en ${dondeAparece(resumen)}.` : undefined}
        migas={[{ titulo: 'Códigos internos', ruta: '/codigos-internos' }, { titulo: codigo }]}
      />

      {!resumen ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">Este código no aparece en el sistema</p>
            <p className="text-sm text-texto-suave">
              Ningún reporte diario, salida del almacén, requerimiento, compra, unidad ni carga de horas lo lleva.
            </p>
            {sugeridos.length > 0 && (
              <p className="mt-2 text-sm text-texto">
                Se parece a{' '}
                {sugeridos.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ', '}
                    <Link href={enlaceCodigo(s)} className="font-mono text-acento hover:underline">
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
                      <Link href={enlaceCodigo(o, vista)} className="font-mono text-acento hover:underline">
                        {o}
                      </Link>
                    </span>
                  ))}
                  . Si es el mismo, cada uno lleva su parte del avance y del costo por separado: hay que pedir que se corrija donde se escribió.
                </p>
              </TarjetaCuerpo>
            </Tarjeta>
          )}

          <ComoVa c={resumen} />

          <PastillaFiltro
            ruta="/codigos-internos/detalle"
            clave="vista"
            params={params}
            activo={vista === 'avance' ? null : vista}
            etiqueta="Secciones del código"
            opciones={VISTAS_CODIGO.map((v) => ({ valor: v.valor === 'avance' ? null : v.valor, etiqueta: v.etiqueta }))}
          />

          <Vista vista={vista} codigo={codigo} perfil={perfil} />
        </div>
      )}
    </>
  )
}

/** Las cuatro cifras de arriba: lo mismo que la fila de la lista, con más aire. */
function ComoVa({ c }: { c: ResumenCodigo }) {
  const costo = costoDelCodigo(c)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          titulo="Avance"
          valor={c.avance_medio === null ? 'Sin reportes' : <Progreso valor={c.avance_medio} mostrarValor etiqueta="Avance del código" />}
          pie={
            c.trabajos > 0
              ? `${c.trabajos_terminados} de ${c.trabajos} ${c.trabajos === 1 ? 'trabajo terminado' : 'trabajos terminados'}`
              : 'Nadie subió un reporte diario'
          }
        />
        <Indicador
          titulo="Costo hasta hoy"
          valor={
            faltaElPrecio(costo.pen + costo.usd, c.materiales_sin_precio + c.horas_sin_costo) ?? (
              <>
                {moneda(costo.pen)}
                {costo.usd > 0 && <span className="block text-sm">+ {moneda(costo.usd, 'USD')}</span>}
              </>
            )
          }
          pie="Mano de obra y materiales"
        />
        <Indicador
          titulo="Mano de obra"
          valor={faltaElPrecio(c.mano_obra, c.horas_sin_costo, 'Sin costo') ?? moneda(c.mano_obra)}
          tono={c.horas_sin_costo > 0 ? 'aviso' : 'neutro'}
          pie={`${horasCortas(c.horas)} de personal${c.horas_sin_costo > 0 ? ` · ${horasCortas(c.horas_sin_costo)} sin costo` : ''}`}
        />
        <Indicador
          titulo="Materiales"
          valor={
            faltaElPrecio(c.materiales_pen + c.materiales_usd, c.materiales_sin_precio) ?? (
              <>
                {moneda(c.materiales_pen)}
                {c.materiales_usd > 0 && <span className="block text-sm">+ {moneda(c.materiales_usd, 'USD')}</span>}
              </>
            )
          }
          tono={c.materiales_sin_precio > 0 ? 'aviso' : 'neutro'}
          pie={`${c.salidas} ${c.salidas === 1 ? 'salida' : 'salidas'} del almacén${c.materiales_sin_precio > 0 ? ` · ${c.materiales_sin_precio} sin precio` : ''}`}
        />
      </div>
      {(c.compras_pen > 0 || c.compras_usd > 0 || c.compras > 0) && (
        <p className="text-xs text-texto-suave">
          Compras con este código: <span className="tabular text-texto">{moneda(c.compras_pen)}</span>
          {c.compras_usd > 0 && <span className="tabular text-texto"> + {moneda(c.compras_usd, 'USD')}</span>} sin IGV en {c.compras}{' '}
          {c.compras === 1 ? 'OC' : 'OC'}. No se suman al costo: lo comprado entra al almacén y se cuenta cuando sale para este código.
        </p>
      )}
    </div>
  )
}

/** Cada pestaña carga solo lo suyo. */
async function Vista({ vista, codigo, perfil }: { vista: VistaCodigo; codigo: string; perfil: PerfilSesion }) {
  if (vista === 'costeo') return <VistaCosteo codigo={codigo} perfil={perfil} />
  if (vista === 'personal') return <VistaPersonal codigo={codigo} />
  if (vista === 'documentos') return <VistaDocumentos codigo={codigo} perfil={perfil} />
  return <VistaAvance codigo={codigo} perfil={perfil} />
}

async function VistaAvance({ codigo, perfil }: { codigo: string; perfil: PerfilSesion }) {
  const filas = await avanceDelCodigo(codigo)
  const trabajos = ultimoAvancePorTrabajo(filas)
  const abreReporte = puede(perfil, ['reporte_diario.ver', 'reporte_diario.registrar'])

  type Reporte = { id: string; fecha: string; creado_en: string; asunto: string; area: string | null; estado: string; horas: number; personal_general: boolean; trabajos: typeof filas }
  const reportes = new Map<string, Reporte>()
  for (const f of filas) {
    const r = reportes.get(f.reporte_id) ?? {
      id: f.reporte_id,
      fecha: f.fecha,
      creado_en: f.creado_en,
      asunto: f.asunto,
      area: f.area,
      estado: f.estado,
      horas: f.horas_reporte,
      personal_general: f.personal_general,
      trabajos: [],
    }
    r.trabajos.push(f)
    reportes.set(f.reporte_id, r)
  }
  const lista = [...reportes.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado_en.localeCompare(a.creado_en))

  if (lista.length === 0) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="text-sm font-medium text-texto">Sin reportes diarios de este código</p>
          <p className="text-sm text-texto-suave">
            El avance sale del reporte diario que sube cada supervisor por código interno. Mientras no haya uno, en «Costeo» se ve lo que ya se gastó.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  return (
    <>
      <Tarjeta>
        <TarjetaCabecera
          titulo="Cada trabajo con su último avance"
          descripcion="El porcentaje que el supervisor puso la última vez que reportó cada trabajo. El avance del código es el promedio de estos."
        />
        <TarjetaCuerpo>
          <ul className="space-y-3">
            {trabajos.map((t) => (
              <li key={t.trabajo} className="text-sm" data-trabajo={t.trabajo}>
                <div className="grid grid-cols-[1fr_8rem] items-center gap-3">
                  <span className="text-texto">{t.trabajo}</span>
                  <Progreso valor={t.avance} mostrarValor etiqueta={`Avance de ${t.trabajo}`} />
                </div>
                <p className="text-xs text-texto-suave">
                  {t.historial.length > 1
                    ? t.historial.map((h) => `${h.avance} % el ${fecha(h.fecha)}`).join(' → ')
                    : `Reportado el ${fecha(t.fecha)}`}
                </p>
              </li>
            ))}
          </ul>
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera
          titulo="Reportes diarios"
          descripcion="Los reportes vigentes de este código, del más nuevo al más viejo. Los anulados no cuentan para el avance ni para las horas."
        />
        <TarjetaCuerpo>
          <ul className="space-y-3">
            {lista.map((r) => {
              const estado = ESTADO_REPORTE[r.estado as EstadoReporte] ?? ESTADO_REPORTE.POR_VALIDAR
              const cuerpo = (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-texto-suave first-letter:uppercase">
                        {fechaLarga(r.fecha)} · {r.area ?? 'Sin área'}
                      </p>
                      <p className="font-semibold text-texto">{r.asunto}</p>
                    </div>
                    <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {[...r.trabajos]
                      .sort((a, b) => a.trabajo_orden - b.trabajo_orden)
                      .map((t) => (
                        <li key={t.trabajo_orden} className="grid grid-cols-[1fr_6.5rem] items-center gap-3 text-xs">
                          <span className="text-texto">
                            {t.trabajo}
                            {t.horas !== null && t.horas > 0 && (
                              <span className="text-texto-suave">
                                {' '}
                                · {horasCortas(t.horas)}, {t.personas} {t.personas === 1 ? 'persona' : 'personas'}
                              </span>
                            )}
                          </span>
                          <Progreso valor={t.avance} alto="sm" mostrarValor etiqueta={`Avance de ${t.trabajo}`} />
                        </li>
                      ))}
                  </ul>
                  <p className="mt-2 text-xs text-texto-suave">
                    <span className="tabular">{horasCortas(r.horas)}</span> de personal{r.personal_general && ' · personal general'}
                  </p>
                </>
              )
              return (
                <li key={r.id} data-reporte={r.id}>
                  {abreReporte ? (
                    <Link href={`/reportes-diarios/${r.id}`} className="block rounded-[var(--radius-base)] border border-borde p-3 hover:border-acento">
                      {cuerpo}
                    </Link>
                  ) : (
                    <div className="rounded-[var(--radius-base)] border border-borde p-3">{cuerpo}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}

async function VistaCosteo({ codigo, perfil }: { codigo: string; perfil: PerfilSesion }) {
  const [lineas, compras] = await Promise.all([costeoDelCodigo(codigo), comprasDelCodigo(codigo)])
  const manoObra = lineas.filter((l) => l.fuente === 'MANO_OBRA' || l.fuente === 'MANO_OBRA_SIN_COSTO')
  const materiales = lineas.filter((l) => l.fuente === 'MATERIALES' || l.fuente === 'MATERIALES_SIN_PRECIO')
  const suma = (ls: typeof lineas, m: 'PEN' | 'USD') => ls.reduce((n, l) => n + (l.moneda === m ? (l.monto ?? 0) : 0), 0)
  const horasMo = manoObra.reduce((n, l) => n + (l.horas ?? 0), 0)
  const abrePdf = puede(perfil, ['compras.ver', 'almacen.recibir'])

  return (
    <>
      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Mano de obra"
          descripcion="Las horas del reporte diario y las que carga Recursos Humanos, a lo que cuesta la hora de cada persona. Las horas de quien todavía no tiene costo se muestran sin sumar hasta que RR. HH. se lo ponga."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Fecha</TH>
              <TH>Trabajo</TH>
              <TH className="text-right">Horas</TH>
              <TH className="text-right">Costo</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {manoObra.length === 0 ? (
              <SinDatos titulo="Sin horas en este código" descripcion="Llegan del reporte diario del supervisor o las carga RR. HH. en su costeo." />
            ) : (
              <>
                {manoObra.map((l, i) => (
                  <TR key={`${l.referencia_id ?? 'rrhh'}-${l.fecha}-${l.concepto}-${l.fuente}-${i}`}>
                    <TD className="tabular align-top whitespace-nowrap">{fecha(l.fecha)}</TD>
                    <TD className="align-top">
                      <p className="text-texto">{l.concepto}</p>
                      <p className="text-xs text-texto-suave">
                        {l.detalle}
                        {l.cantidad > 0 && ` · ${l.cantidad} ${l.cantidad === 1 ? 'persona' : 'personas'}`}
                      </p>
                    </TD>
                    <TD className="tabular text-right align-top">{horasCortas(l.horas ?? 0)}</TD>
                    <TD className="tabular text-right align-top">
                      {l.fuente === 'MANO_OBRA_SIN_COSTO' ? <Insignia tono="aviso">Sin costo</Insignia> : moneda(l.monto)}
                    </TD>
                  </TR>
                ))}
                <TR className="font-semibold">
                  <TD colSpan={2}>Total</TD>
                  <TD className="tabular text-right">{horasCortas(horasMo)}</TD>
                  <TD className="tabular text-right">
                    {faltaElPrecio(suma(manoObra, 'PEN'), manoObra.filter((l) => l.fuente === 'MANO_OBRA_SIN_COSTO').length, 'Sin costo') ??
                      moneda(suma(manoObra, 'PEN'))}
                  </TD>
                </TR>
              </>
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Materiales salidos del almacén"
          descripcion="Cada salida para este código a su precio: el que quedó en la salida, o el de la última compra del material hasta ese día, o el de la valorización del almacén. Lo que no tiene ninguno sale «Sin precio» y no se suma como cero."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Fecha</TH>
              <TH>Material</TH>
              <TH className="text-right">Cantidad</TH>
              <TH className="hidden text-right sm:table-cell">Precio</TH>
              <TH className="text-right">Importe</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {materiales.length === 0 ? (
              <SinDatos titulo="Ninguna salida del almacén para este código" descripcion="Almacén las registra en el kardex con el código de la unidad o por su requerimiento." />
            ) : (
              <>
                {materiales.map((l, i) => (
                  <TR key={`${l.referencia_id ?? i}`}>
                    <TD className="tabular align-top whitespace-nowrap">{fecha(l.fecha)}</TD>
                    <TD className="align-top">
                      <p className="text-texto">{l.concepto}</p>
                      <p className="text-xs text-texto-suave">
                        {[l.documento, l.detalle].filter(Boolean).join(' · ')}
                      </p>
                    </TD>
                    <TD className="tabular text-right align-top whitespace-nowrap">
                      {cantidad(l.cantidad)} {l.unidad}
                    </TD>
                    <TD className="tabular hidden text-right align-top sm:table-cell">
                      {l.precio_unitario === null ? '—' : moneda(l.precio_unitario, l.moneda ?? 'PEN')}
                    </TD>
                    <TD className="tabular text-right align-top">
                      {l.fuente === 'MATERIALES_SIN_PRECIO' ? <Insignia tono="aviso">Sin precio</Insignia> : moneda(l.monto, l.moneda ?? 'PEN')}
                    </TD>
                  </TR>
                ))}
                <TR className="font-semibold">
                  <TD colSpan={2}>Total</TD>
                  <TD />
                  <TD className="hidden sm:table-cell" />
                  <TD className="tabular text-right">
                    {faltaElPrecio(suma(materiales, 'PEN') + suma(materiales, 'USD'), materiales.filter((l) => l.fuente === 'MATERIALES_SIN_PRECIO').length) ??
                      moneda(suma(materiales, 'PEN'))}
                    {suma(materiales, 'USD') > 0 && <p>+ {moneda(suma(materiales, 'USD'), 'USD')}</p>}
                  </TD>
                </TR>
              </>
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Compras con este código"
          descripcion="Las órdenes de compra sin IGV, menos las rechazadas. No se suman al costo: lo comprado entra al almacén y se cuenta cuando sale para este código."
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
    </>
  )
}

async function VistaPersonal({ codigo }: { codigo: string }) {
  const personas = await personalDelCodigo(codigo)
  const horas = personas.reduce((n, p) => n + p.horas, 0)
  return (
    <Tarjeta className="overflow-hidden">
      <TarjetaCabecera
        titulo="Quién trabajó en este código"
        descripcion="Las horas de cada persona, del reporte diario y las cargadas por Recursos Humanos. Sin lo que cuesta cada una: eso lo ve solo RR. HH."
      />
      <Tabla>
        <TablaCabecera>
          <tr>
            <TH>Persona</TH>
            <TH className="text-right">Días</TH>
            <TH className="text-right">Horas</TH>
            <TH className="hidden sm:table-cell">Desde y hasta</TH>
          </tr>
        </TablaCabecera>
        <tbody>
          {personas.length === 0 ? (
            <SinDatos titulo="Nadie tiene horas en este código" descripcion="Llegan del reporte diario del supervisor o las carga RR. HH." />
          ) : (
            <>
              {personas.map((p) => (
                <TR key={p.trabajador_id} data-persona={p.trabajador_id}>
                  <TD className="align-top">
                    <p className="text-texto">{p.nombre}</p>
                    <p className="text-xs text-texto-suave">{p.cargo ?? 'Sin cargo'}</p>
                  </TD>
                  <TD className="tabular text-right align-top">{p.dias}</TD>
                  <TD className="tabular text-right align-top">
                    {horasCortas(p.horas)}
                    {p.horas_sin_costo > 0 && <p className="text-xs text-aviso">{horasCortas(p.horas_sin_costo)} sin costo</p>}
                  </TD>
                  <TD className="tabular hidden align-top text-xs text-texto-suave sm:table-cell">
                    {p.primer_dia === p.ultimo_dia ? fecha(p.primer_dia) : `${fecha(p.primer_dia)} al ${fecha(p.ultimo_dia)}`}
                  </TD>
                </TR>
              ))}
              <TR className="font-semibold">
                <TD colSpan={2}>
                  {personas.length} {personas.length === 1 ? 'persona' : 'personas'}
                </TD>
                <TD className="tabular text-right">{horasCortas(horas)}</TD>
                <TD className="hidden sm:table-cell" />
              </TR>
            </>
          )}
        </tbody>
      </Tabla>
    </Tarjeta>
  )
}

async function VistaDocumentos({ codigo, perfil }: { codigo: string; perfil: PerfilSesion }) {
  const documentos = await documentosDelCodigo(codigo)
  const enlace: Record<string, ((d: (typeof documentos)[number]) => string) | null> = {
    OT: puede(perfil, 'ordenes.ver') ? (d) => `/ordenes/${d.id}` : null,
    COTIZACION: puede(perfil, 'cotizaciones.ver_pdf_comercial') ? (d) => `/cotizaciones/pdf?q=${encodeURIComponent(d.numero)}` : null,
    UNIDAD: puede(perfil, ['clientes.ver', 'produccion.ver']) ? (d) => `/unidades/${d.id}` : null,
    REQUERIMIENTO: null,
    VEHICULO: puede(perfil, ['vehiculos.registrar', 'vehiculos.ver']) ? (d) => `/vehiculos/${d.id}` : null,
  }
  const estado = (tipo: string, valor: string) =>
    tipo === 'REQUERIMIENTO'
      ? definir(ESTADO_REQUERIMIENTO, valor)
      : tipo === 'OT'
        ? definir(ESTADO_OT, valor)
        : definir(ESTADO_DOCUMENTO_CODIGO, valor)

  return (
    <>
      <p className="text-sm text-texto-suave">
        Hoy la OT y la cotización se encuentran por la unidad: si en Unidades una unidad lleva este código, aquí salen su OT y la cotización PDF
        de esa OT. Los reportes, las salidas del almacén, los requerimientos y las compras llevan el código escrito a mano.
      </p>
      {Object.entries(TIPO_DOCUMENTO_CODIGO).map(([tipo, def]) => {
        const deTipo = documentos.filter((d) => d.tipo === tipo)
        const abrir = enlace[tipo]
        return (
          <Tarjeta key={tipo} data-tipo={tipo}>
            <TarjetaCabecera titulo={`${def.titulo}${deTipo.length > 0 ? ` (${deTipo.length})` : ''}`} />
            <TarjetaCuerpo>
              {deTipo.length === 0 ? (
                <p className="text-sm text-texto-suave">{def.vacio}</p>
              ) : (
                <ul className="divide-y divide-borde">
                  {deTipo.map((d) => {
                    const e = estado(tipo, d.estado)
                    return (
                      <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          {abrir ? (
                            <Link href={abrir(d)} className="font-medium text-acento hover:underline">
                              {d.numero}
                            </Link>
                          ) : (
                            <p className="font-medium text-texto">{d.numero}</p>
                          )}
                          {d.detalle && <p className="text-xs text-texto-suave">{d.detalle}</p>}
                        </div>
                        <div className="text-right">
                          <Insignia tono={e.tono}>{e.etiqueta}</Insignia>
                          {d.fecha && <p className="tabular mt-0.5 text-xs text-texto-suave">{fecha(d.fecha)}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )
      })}
    </>
  )
}
