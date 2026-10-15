import { Search } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Boton } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { codigosParaSubcontratos, listarSubcontratistas, listarSubcontratos, type Subcontratista, type SubcontratoListado } from '@/lib/datos/subcontratos'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { ESTADO_SUBCONTRATO, cuentasDeSubcontrato, estadoDeSubcontrato, nombreDeAreaSubcontrato } from '@/lib/dominio/subcontratos'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FormularioSubcontratista, NuevoSubcontrato } from './formularios'

export const metadata = { title: 'Subcontratos' }

type Params = { vista?: string; codigo?: string; estado?: string }

export default async function PaginaSubcontratos({ searchParams }: { searchParams: Promise<Params> }) {
  const perfil = await exigirPermiso(['subcontratos.gestionar', 'subcontratos.ver', 'subcontratos.pagar'])
  const gestiona = puede(perfil, 'subcontratos.gestionar')
  const params = await searchParams
  const vista = params.vista === 'subcontratistas' ? 'subcontratistas' : 'subcontratos'

  const pestanas = (
    <PastillaFiltro
      ruta="/subcontratos"
      clave="vista"
      etiqueta="Qué ver"
      opciones={[
        { valor: null, etiqueta: 'Subcontratos' },
        { valor: 'subcontratistas', etiqueta: 'Subcontratistas' },
      ]}
      params={{}}
      activo={vista === 'subcontratistas' ? 'subcontratistas' : null}
      className="mb-4"
    />
  )

  if (vista === 'subcontratistas') {
    const subcontratistas = await listarSubcontratistas()
    return (
      <>
        <EncabezadoPagina
          titulo="Subcontratistas"
          descripcion="Las personas de fuera que hacen trabajos para la casa y cobran con recibos por honorarios, con la cuenta donde Tesorería les paga."
          migas={[{ titulo: 'Administración' }, { titulo: 'Subcontratos', ruta: '/subcontratos' }, { titulo: 'Subcontratistas' }]}
          acciones={gestiona && <FormularioSubcontratista />}
        />
        {pestanas}
        <Padron subcontratistas={subcontratistas} gestiona={gestiona} />
      </>
    )
  }

  const buscado = (params.codigo ?? '').trim()
  const estado = params.estado === 'TERMINADO' || params.estado === 'ANULADO' || params.estado === 'todos' ? params.estado : 'VIGENTE'
  const [subcontratos, subcontratistas, codigos] = await Promise.all([
    listarSubcontratos(),
    gestiona ? listarSubcontratistas() : Promise.resolve([]),
    gestiona ? codigosParaSubcontratos() : Promise.resolve([]),
  ])
  // El código se compara como en «Códigos internos»: sin mayúsculas, espacios ni signos, y O igual a 0.
  const llave = llaveParecido(buscado)
  const visibles = subcontratos.filter(
    (s) => (estado === 'todos' || s.estado === estado) && (!buscado || llaveParecido(s.codigo_interno).includes(llave)),
  )
  const cuenta = (e: string) => subcontratos.filter((s) => s.estado === e).length
  // Lo que falta pagar, en soles: los subcontratos en dólares, que son raros, se ven en su fila.
  const porPagar = subcontratos.filter((s) => s.moneda === 'PEN').reduce((n, s) => n + cuentasDeSubcontrato(s.monto, s.recibos).porPagar, 0)
  // Los de antes del área (migración 20261017100000): ni Producción ni Acabados los ven hasta que se les ponga.
  const sinArea = subcontratos.filter((s) => s.estado !== 'ANULADO' && !s.area_codigo).length
  const recibosPorPagar = subcontratos.reduce(
    (n, s) => n + s.recibos.filter((r) => !r.anulado_en && !r.pagos.some((p) => !p.anulado_en)).length,
    0,
  )

  return (
    <>
      <EncabezadoPagina
        titulo="Subcontratos"
        descripcion="Los trabajos que se le encargan a una persona de fuera, por código interno de la unidad y para Producción o Acabados, cuyo supervisor los ve sin montos. Contra cada uno se suben sus recibos por honorarios; Tesorería los paga y adjunta el voucher."
        migas={[{ titulo: 'Administración' }, { titulo: 'Subcontratos' }]}
        acciones={gestiona && <NuevoSubcontrato subcontratistas={subcontratistas} codigos={codigos} />}
      />
      {pestanas}

      {gestiona && sinArea > 0 && (
        <p className="mb-4 rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-sin-area>
          {sinArea === 1 ? 'Un subcontrato no tiene' : `${sinArea} subcontratos no tienen`} área: ni Producción ni Acabados{' '}
          {sinArea === 1 ? 'lo ven' : 'los ven'}. Ábrelo y elige el área con «Corregir».
        </p>
      )}

      {recibosPorPagar > 0 && (
        <p className="mb-4 rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-por-pagar>
          {recibosPorPagar === 1 ? 'Un recibo espera' : `${recibosPorPagar} recibos esperan`} el pago de Tesorería
          {porPagar > 0 && (
            <>
              {' '}
              por <span className="tabular font-semibold">{moneda(porPagar)}</span> neto
            </>
          )}
          .
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PastillaFiltro
          ruta="/subcontratos"
          clave="estado"
          etiqueta="Estado"
          opciones={[
            { valor: null, etiqueta: `Vigentes (${cuenta('VIGENTE')})` },
            { valor: 'TERMINADO', etiqueta: `Terminados (${cuenta('TERMINADO')})` },
            { valor: 'ANULADO', etiqueta: `Anulados (${cuenta('ANULADO')})` },
            { valor: 'todos', etiqueta: 'Todos' },
          ]}
          params={params}
          activo={estado === 'VIGENTE' ? null : estado}
        />
        <form className="flex max-w-md flex-1 gap-2" role="search">
          {estado !== 'VIGENTE' && <input type="hidden" name="estado" value={estado} />}
          <Entrada name="codigo" defaultValue={buscado} placeholder="Código interno, por ejemplo PLA_SR_O4_1_26/28" aria-label="Buscar por código interno" />
          <Boton type="submit" variante="secundario">
            <Search aria-hidden className="size-4" />
            Buscar
          </Boton>
        </form>
      </div>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Subcontrato</TH>
              <TH className="hidden md:table-cell">Código y área</TH>
              <TH className="hidden text-right sm:table-cell">Pactado</TH>
              <TH className="hidden text-right lg:table-cell">Recibido</TH>
              <TH className="hidden sm:table-cell">En qué va</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {visibles.length === 0 ? (
              <SinDatos
                titulo={buscado ? `Ningún subcontrato lleva el código ${buscado}` : estado === 'VIGENTE' ? 'No hay subcontratos vigentes' : 'No hay subcontratos aquí'}
                descripcion={
                  buscado
                    ? 'Revisa cómo está escrito o borra la búsqueda para ver todos.'
                    : gestiona
                      ? 'Registra el primero con «Nuevo subcontrato». Si la persona no está en el padrón, dala de alta en «Subcontratistas».'
                      : 'Administración los registra; aparecen aquí con su número.'
                }
              />
            ) : (
              visibles.map((s) => <FilaSubcontrato key={s.id} s={s} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaSubcontrato({ s }: { s: SubcontratoListado }) {
  const c = cuentasDeSubcontrato(s.monto, s.recibos)
  const def = ESTADO_SUBCONTRATO[estadoDeSubcontrato(s.estado)]
  const anulado = s.estado === 'ANULADO'
  return (
    <TR data-subcontrato={s.numero}>
      <TD>
        <Link href={`/subcontratos/${s.id}`} className={`tabular font-semibold text-acento hover:underline ${anulado ? 'line-through' : ''}`}>
          {s.numero}
        </Link>
        <p className="text-xs text-texto">{s.subcontratista?.nombre ?? 'Subcontratista'}</p>
        <p className="mt-1 line-clamp-2 text-xs text-texto-suave">{s.descripcion}</p>
        {(s.fecha_inicio || s.fecha_fin) && (
          <p className="text-[11px] text-texto-suave">
            {fecha(s.fecha_inicio)} → {fecha(s.fecha_fin)}
          </p>
        )}
        {s.motivo_anulacion && <p className="mt-1 text-xs text-peligro">Anulado: {s.motivo_anulacion}</p>}
        <p className="tabular mt-1 text-[11px] font-medium text-texto md:hidden" data-codigo>
          {s.codigo_interno} · <Area codigo={s.area_codigo} />
        </p>
        {/* En el teléfono, lo pactado y en qué va van aquí: la tabla no cabe con sus columnas. */}
        <div className="mt-2 space-y-1 sm:hidden">
          <p className="tabular text-sm font-semibold text-texto">{moneda(s.monto, s.moneda)} pactado</p>
          <EnQueVa tono={def.tono} etiqueta={def.etiqueta} cuentas={c} monedaSc={s.moneda} />
        </div>
      </TD>
      <TD className="hidden md:table-cell">
        <p className="tabular font-medium text-texto">{s.codigo_interno}</p>
        <p className="text-xs" data-area>
          <Area codigo={s.area_codigo} />
        </p>
      </TD>
      <TD className="tabular hidden text-right whitespace-nowrap sm:table-cell">{moneda(s.monto, s.moneda)}</TD>
      <TD className="tabular hidden text-right whitespace-nowrap lg:table-cell">
        {moneda(c.recibido, s.moneda)}
        <p className="text-[11px] text-texto-suave">
          {c.recibos} {c.recibos === 1 ? 'recibo' : 'recibos'}
        </p>
      </TD>
      <TD className="hidden sm:table-cell">
        <EnQueVa tono={def.tono} etiqueta={def.etiqueta} cuentas={c} monedaSc={s.moneda} />
      </TD>
    </TR>
  )
}

/** Para qué área va, o el aviso de que todavía no tiene. */
function Area({ codigo }: { codigo: string | null }) {
  const nombre = nombreDeAreaSubcontrato(codigo)
  return nombre ? <span className="text-texto-suave">{nombre}</span> : <span className="text-aviso">Sin área</span>
}

function EnQueVa({
  tono,
  etiqueta,
  cuentas: c,
  monedaSc,
}: {
  tono: Tono
  etiqueta: string
  cuentas: ReturnType<typeof cuentasDeSubcontrato>
  monedaSc: 'PEN' | 'USD'
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <Insignia tono={tono}>{etiqueta}</Insignia>
      {c.porPagar > 0 && <Insignia tono="aviso">Por pagar {moneda(c.porPagar, monedaSc)}</Insignia>}
      {c.recibos > 0 && c.porPagar === 0 && <Insignia tono="exito">Recibos pagados</Insignia>}
    </div>
  )
}

function Padron({ subcontratistas, gestiona }: { subcontratistas: Subcontratista[]; gestiona: boolean }) {
  return (
    <Tarjeta className="overflow-hidden">
      <Tabla>
        <TablaCabecera>
          <tr>
            <TH>Subcontratista</TH>
            <TH className="hidden sm:table-cell">Cuenta donde se le paga</TH>
            {gestiona && (
              <TH className="text-right">
                <span className="sr-only">Acciones</span>
              </TH>
            )}
          </tr>
        </TablaCabecera>
        <tbody>
          {subcontratistas.length === 0 ? (
            <SinDatos
              titulo="El padrón está vacío"
              descripcion={gestiona ? 'Da de alta al primero con «Nuevo subcontratista»: su RUC, su nombre y su cuenta.' : 'Administración los da de alta.'}
            />
          ) : (
            subcontratistas.map((s) => (
              <TR key={s.id} data-subcontratista={s.ruc} className={s.activo ? '' : 'opacity-60'}>
                <TD>
                  <p className="font-medium text-texto">{s.nombre}</p>
                  <p className="tabular text-xs text-texto-suave">
                    RUC {s.ruc}
                    {s.telefono && ` · ${s.telefono}`}
                  </p>
                  {!s.activo && (
                    <Insignia tono="neutro" className="mt-1">
                      Dado de baja
                    </Insignia>
                  )}
                  <p className="mt-1 text-xs text-texto-suave sm:hidden">
                    <Cuenta s={s} />
                  </p>
                </TD>
                <TD className="hidden text-sm sm:table-cell">
                  <Cuenta s={s} />
                </TD>
                {gestiona && (
                  <TD className="text-right">
                    <FormularioSubcontratista subcontratista={s} />
                  </TD>
                )}
              </TR>
            ))
          )}
        </tbody>
      </Tabla>
    </Tarjeta>
  )
}

function Cuenta({ s }: { s: Pick<Subcontratista, 'banco' | 'numero_cuenta' | 'cci'> }) {
  if (!s.numero_cuenta && !s.cci) return <span className="text-aviso">Sin cuenta: Tesorería no sabrá dónde pagarle</span>
  return (
    <>
      {s.banco}
      {s.numero_cuenta && (
        <>
          {' · '}
          <span className="tabular text-texto">{s.numero_cuenta}</span>
        </>
      )}
      {s.cci && <span className="tabular"> · CCI {s.cci}</span>}
    </>
  )
}
