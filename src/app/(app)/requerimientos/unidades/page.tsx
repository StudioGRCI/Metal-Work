import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { etapasDeCodigo, planosDeCodigo, type EtapaDeCodigo } from '@/lib/datos/diseno-codigos'
import { cargarRequerimientos, catalogosDelRequerimiento, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { CODIGO_FIJO_PLANTA, llaveParecido, normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { ESTADOS_RQ_ABIERTOS, estadoDelRequerimiento } from '@/lib/dominio/requerimientos'
import { fecha, porcentaje } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import { AvisoDeLaUnidad, BotonPedirParaUnidad, PedirPorUnidad } from './pedir'

export const metadata = { title: 'RQ por unidad' }

/** Lo de una unidad en el área: sus etapas, los planos que faltan recibir y sus RQ. */
type DeLaUnidad = { etapas: EtapaDeCodigo[]; porRecibir: number; rqs: RequerimientoListado[] }

const abierto = (r: RequerimientoListado) => (ESTADOS_RQ_ABIERTOS as readonly string[]).includes(r.estado)
/** Al área todavía le falta algo con la unidad: una etapa sin terminar, un plano por recibir o un RQ que no llega. */
const sigueEnElArea = (u: DeLaUnidad) => u.porRecibir > 0 || u.etapas.some((e) => !e.fin_real) || u.rqs.some(abierto)
/** Ya se trabaja en ella: la etapa empezó o tiene fecha, o hay un plano por recibir. */
const enMarcha = (u: DeLaUnidad) => u.porRecibir > 0 || u.etapas.some((e) => !e.fin_real && (e.inicio_real || e.inicio_plan))

function estadoDeEtapa(e: EtapaDeCodigo): { texto: string; tono: Tono } {
  if (e.fin_real) return { texto: 'Terminada', tono: 'exito' }
  if (e.inicio_real) return { texto: 'En marcha', tono: 'info' }
  if (e.inicio_plan) return { texto: `Empieza ${fecha(e.inicio_plan)}`, tono: 'neutro' }
  return { texto: 'Sin fecha', tono: 'neutro' }
}

/**
 * Las unidades que tiene el área del supervisor, cada una con lo que su área
 * hace en ella y sus requerimientos, para pedir el material de cada una desde
 * su tarjeta (pedido de supervisión de Acabados, 20/11/2026). Una unidad está
 * en el área mientras le falta algo ahí: una etapa sin terminar, un plano por
 * recibir o un RQ que todavía no se entrega. Lo que no es de una unidad va en
 * PLANTA, al final.
 *
 * Las etapas y los planos son los de «Planos y etapas»; los RQ, los que pidió
 * el área. El permiso es el mismo que exige la base para registrar
 * (`requerimientos.area`, `rq_exigir_del_area`).
 */
export default async function PaginaRqPorUnidad({ searchParams }: PageProps<'/requerimientos/unidades'>) {
  const perfil = await exigirPermiso('requerimientos.area')
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const area = perfil.area_id

  const [planos, etapas, requerimientos, catalogos] = await Promise.all([
    area ? planosDeCodigo(null, { conPeso: false }) : Promise.resolve([]),
    area ? etapasDeCodigo(null) : Promise.resolve([]),
    area ? cargarRequerimientos({ area, tipo: 'OPERACION' }) : Promise.resolve([]),
    catalogosDelRequerimiento(),
  ])
  const areaFija = catalogos.areas.find((a) => a.id === area && a.requerimiento === 'OPERACION')
  const unidadDe = new Map((catalogos.codigos ?? []).map((c) => [c.codigo, c.unidad]))
  // Gerencia cerró el costeo al entregarla: ya no se le pide nada.
  const cerrados = new Set((catalogos.codigos ?? []).filter((c) => c.cerrado).map((c) => c.codigo))

  // Lo de cada código, juntado de una pasada.
  const porCodigo = new Map<string, DeLaUnidad>()
  const de = (codigo: string) => {
    const hay = porCodigo.get(codigo)
    if (hay) return hay
    const nuevo: DeLaUnidad = { etapas: [], porRecibir: 0, rqs: [] }
    porCodigo.set(codigo, nuevo)
    return nuevo
  }
  for (const e of etapas) if (e.area_id === area) de(e.codigo).etapas.push(e)
  for (const p of planos) if (p.area_id === area && !p.anulado_en && !p.recibido_en) de(p.codigo).porRecibir++
  const dePlanta: RequerimientoListado[] = []
  for (const r of requerimientos) {
    if (normalizarCodigo(r.codigo_interno) === CODIGO_FIJO_PLANTA.codigo) dePlanta.push(r)
    else de(normalizarCodigo(r.codigo_interno)).rqs.push(r)
  }

  // Se busca por el código o por la placa y la marca, como en el buscador de código.
  const palabras = palabrasDeBusqueda(q)
  const llave = llaveParecido(q)
  const buscado = (codigo: string) =>
    !q || coincide(palabras, [codigo, unidadDe.get(codigo) ?? '']) || (llave !== '' && llaveParecido(codigo).includes(llave))

  // Una unidad entregada sale aunque Diseño no haya cerrado sus etapas; si le
  // queda un RQ en camino, se ve para seguirlo, sin «Nuevo RQ».
  const enElArea = [...porCodigo.entries()].filter(([codigo, u]) => (cerrados.has(codigo) ? u.rqs.some(abierto) : sigueEnElArea(u)))
  const unidades = enElArea
    .filter(([codigo]) => buscado(codigo))
    .sort(([a, ua], [b, ub]) => Number(enMarcha(ub)) - Number(enMarcha(ua)) || (a < b ? -1 : a > b ? 1 : 0))
  const conRqAbierto = enElArea.filter(([, u]) => u.rqs.some(abierto)).length
  // Las demás unidades del padrón que siguen en el taller (sin costeo cerrado):
  // mientras Diseño no carga etapas ni planos del área, son la única vista
  // previa que tiene el supervisor, y desde ellas también pide.
  const deLaLista = new Set(enElArea.map(([codigo]) => codigo))
  const otras = (catalogos.codigos ?? [])
    .filter((c) => c.registrada && !c.cerrado && c.codigo !== CODIGO_FIJO_PLANTA.codigo && !deLaLista.has(c.codigo))
    .filter((c) => buscado(c.codigo))

  const vistas = [
    { clave: 'unidades', titulo: 'Por unidad', href: '/requerimientos/unidades', activa: true, cuenta: enElArea.length },
    { clave: 'mia', titulo: 'De tu área', href: '/requerimientos', activa: false },
    { clave: 'todas', titulo: 'Todas las áreas', href: '/requerimientos?area=todas', activa: false },
  ]

  if (!area || !areaFija) {
    return (
      <>
        <EncabezadoPagina titulo="RQ por unidad" migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Por unidad' }]} />
        <Tarjeta>
          <SinDatos
            enTabla={false}
            titulo={area ? 'Tu área no pide por el requerimiento de operación' : 'Tu cuenta no tiene área'}
            descripcion="Pide a Administración que revise el área de tu cuenta: con ella ves aquí sus unidades y pides el material de cada una."
          />
        </Tarjeta>
      </>
    )
  }

  return (
    <PedirPorUnidad {...catalogos} tipos={['OPERACION']} areaFija={areaFija}>
      <EncabezadoPagina
        titulo="RQ por unidad"
        descripcion={`${areaFija.nombre} · ${enElArea.length} ${enElArea.length === 1 ? 'unidad' : 'unidades'}${
          conRqAbierto > 0 ? `, ${conRqAbierto} con requerimientos en camino` : ''
        }`}
        ayuda="Cada unidad que tiene trabajo en tu área, con sus etapas y sus requerimientos. Pide el material de una unidad con «Nuevo RQ» en su tarjeta: el código y el área ya van puestos y le llega a Almacén. Una unidad sale de aquí cuando tu área termina sus etapas, recibe sus planos y le entregan todo lo pedido. Debajo están las demás unidades del taller, para pedir aunque Diseño todavía no cargue el trabajo de tu área. Lo que no es de una unidad, pídelo en PLANTA, al final."
        migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Por unidad' }]}
        acciones={<BotonPedirParaUnidad codigo={null}>Nuevo RQ con otro código</BotonPedirParaUnidad>}
        estado={<AvisoDeLaUnidad codigo={null} />}
      />

      <div className="mb-4 space-y-3">
        <Vistas etiqueta="Requerimiento" vistas={vistas} />
        <BuscadorSimple ruta="/requerimientos/unidades" etiqueta="Buscar unidad" marcador="Código interno, placa o marca" />
      </div>

      {unidades.length === 0 ? (
        <Tarjeta className="mb-3">
          <SinDatos
            enTabla={false}
            titulo={q ? 'Ninguna unidad de tu área con esta búsqueda' : 'Ninguna unidad tiene todavía trabajo cargado para tu área'}
            descripcion={
              otras.length > 0
                ? 'Aparecen aquí cuando Diseño carga una etapa o un plano de tu área. Mientras tanto, pide desde las demás unidades del taller.'
                : q
                  ? 'Borra la búsqueda con «Limpiar», o pide con «Nuevo RQ con otro código» si la unidad todavía no llega al taller.'
                  : 'Aparecen aquí cuando Diseño carga una etapa o un plano de tu área. Si necesitas material para una unidad, pídelo con «Nuevo RQ con otro código».'
            }
            accion={
              otras.length > 0 ? (
                <a href="#otras-unidades" className="text-sm font-medium text-acento hover:underline">
                  Ver las demás unidades del taller
                </a>
              ) : undefined
            }
          />
        </Tarjeta>
      ) : (
        <ul className="mb-3 grid gap-3 lg:grid-cols-2" aria-label={`Unidades de ${areaFija.nombre}`}>
          {unidades.map(([codigo, u]) => (
            <li key={codigo}>
              <TarjetaDeUnidad codigo={codigo} unidad={unidadDe.get(codigo) ?? null} entregada={cerrados.has(codigo)} delArea={u} />
            </li>
          ))}
        </ul>
      )}

      {otras.length > 0 && (
        <Tarjeta className="mb-3" id="otras-unidades">
          <TarjetaCabecera
            titulo={`Las demás unidades del taller (${otras.length})`}
            descripcion="Del padrón de unidades, sin trabajo cargado para tu área todavía. Si ya trabajas en una, pide su material desde aquí."
          />
          <ul className="divide-y divide-borde" aria-label="Las demás unidades del taller">
            {otras.map((c) => (
              <li key={c.codigo} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block font-mono text-sm font-medium text-texto">{c.codigo}</span>
                  {c.unidad && <span className="block truncate text-xs text-texto-suave">{c.unidad}</span>}
                  <AvisoDeLaUnidad codigo={c.codigo} className="mt-1" />
                </span>
                <BotonPedirParaUnidad codigo={c.codigo} />
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {!q && (
        <Tarjeta>
          <TarjetaCabecera
            titulo={<span className="font-mono">{CODIGO_FIJO_PLANTA.codigo}</span>}
            descripcion="Lo que tu área usa sin ser de una unidad: consumibles, herramientas."
            acciones={<BotonPedirParaUnidad codigo={CODIGO_FIJO_PLANTA.codigo} />}
          />
          <TarjetaCuerpo className="space-y-3">
            <AvisoDeLaUnidad codigo={CODIGO_FIJO_PLANTA.codigo} />
            <RequerimientosDeLaUnidad codigo={CODIGO_FIJO_PLANTA.codigo} rqs={dePlanta} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </PedirPorUnidad>
  )
}

function TarjetaDeUnidad({
  codigo,
  unidad,
  entregada,
  delArea,
}: {
  codigo: string
  unidad: string | null
  entregada: boolean
  delArea: DeLaUnidad
}) {
  return (
    <Tarjeta className="h-full">
      <TarjetaCabecera
        titulo={<span className="font-mono">{codigo}</span>}
        descripcion={unidad ?? undefined}
        acciones={entregada ? <Insignia tono="neutro">Entregada</Insignia> : <BotonPedirParaUnidad codigo={codigo} />}
      />
      <TarjetaCuerpo className="space-y-3">
        <AvisoDeLaUnidad codigo={codigo} />
        {entregada && (
          <p className="text-sm text-texto-suave">Gerencia ya cerró su costeo al entregarla: aquí solo sigues lo que quedó en camino.</p>
        )}
        {(delArea.etapas.length > 0 || delArea.porRecibir > 0) && (
          <div>
            <h3 className="text-xs font-medium text-texto-suave">En tu área</h3>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1.5 text-sm">
              {delArea.etapas.map((e) => {
                const estado = estadoDeEtapa(e)
                return (
                  <li key={e.id} className="flex items-center gap-1.5">
                    <span className="text-texto">{e.nombre}</span>
                    <Insignia tono={estado.tono}>{estado.texto}</Insignia>
                  </li>
                )
              })}
              {delArea.porRecibir > 0 && (
                <li>
                  <Link href={`/planos?ver=por-recibir&q=${encodeURIComponent(codigo)}`} className="font-medium text-acento hover:underline">
                    {delArea.porRecibir === 1 ? '1 plano por recibir' : `${delArea.porRecibir} planos por recibir`}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        )}
        <RequerimientosDeLaUnidad codigo={codigo} rqs={delArea.rqs} />
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** Los RQ que van en camino, uno por renglón, y cuántos ya se entregaron. */
function RequerimientosDeLaUnidad({ codigo, rqs }: { codigo: string; rqs: RequerimientoListado[] }) {
  const enCamino = rqs.filter(abierto)
  const entregados = rqs.filter((r) => r.estado === 'ENTREGADO').length
  const anulados = rqs.filter((r) => r.estado === 'ANULADO').length
  const yaCerrados = [
    entregados > 0 ? (entregados === 1 ? '1 entregado' : `${entregados} entregados`) : null,
    anulados > 0 ? (anulados === 1 ? '1 anulado' : `${anulados} anulados`) : null,
  ].filter(Boolean)
  return (
    <div>
      <h3 className="text-xs font-medium text-texto-suave">Requerimientos de tu área</h3>
      {rqs.length === 0 ? (
        <p className="mt-1 text-sm text-texto-suave">Ninguno todavía.</p>
      ) : (
        <>
          {enCamino.length > 0 && (
            <ul className="mt-1 space-y-1 text-sm">
              {enCamino.map((r) => {
                const estado = estadoDelRequerimiento(r)
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/requerimientos?rq=${r.id}`} className="font-mono font-medium text-acento hover:underline">
                      {r.numero}
                    </Link>
                    {estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
                    {r.avance && <span className="tabular text-xs text-texto-suave">{porcentaje(r.avance.porcentaje)}</span>}
                    <span className="min-w-0 basis-full truncate text-xs text-texto-suave sm:basis-auto sm:flex-1">
                      {r.lineas.length === 1 ? r.lineas[0].descripcion : `${r.lineas.length} insumos`}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-1 text-xs text-texto-suave">
            {yaCerrados.length > 0 && `${yaCerrados.join(', ')} · `}
            <Link href={`/requerimientos?codigo=${encodeURIComponent(codigo)}`} className="font-medium text-acento hover:underline">
              {rqs.length === 1 ? 'Ver su requerimiento' : `Ver sus ${rqs.length} requerimientos`}
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
