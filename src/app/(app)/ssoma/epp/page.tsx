import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { AccionesDeFila, DetalleEnTelefono, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import {
  entregasDeEpp,
  eppPorPersona,
  MAXIMO_ENTREGAS_EPP,
  personalParaEpp,
  salidasDeEpp,
  type EntregaDeEpp,
  type PersonaConEpp,
  type PersonaDeLaSalida,
  type PersonaParaMarcar,
  type SalidaDeEpp,
} from '@/lib/datos/ssoma'
import { cuandoSeRenueva, DIAS_DE_AVISO_EPP, tonoDeRenovacion } from '@/lib/dominio/ssoma'
import { cantidad, fecha } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AsignarEpp, EstadoDeLaEntrega, NoSeRenueva, NoVaPorPersona, RepartirSalida } from './controles'

export const metadata = { title: 'Seguridad: EPP por persona' }

const ENLACE = 'inline-flex min-h-11 items-center text-sm font-medium text-texto hover:text-acento hover:underline sm:min-h-0'

/**
 * El equipo de protección de cada persona: lo que hay que renovar, lo que tiene
 * cada quien y las salidas del almacén de EPP que SSOMA reparte entre personas.
 * La salida la registra Almacén y aquí no cambia: SSOMA anota a quién le tocó y
 * hasta cuándo le dura. Gerencia consulta. Lo que cada quien ve lo decide la base.
 */
export default async function PaginaEppSsoma({ searchParams }: PageProps<'/ssoma/epp'>) {
  // Los mismos permisos con que la base deja leer las entregas (`puede_ver_reportes_ssoma`).
  const perfil = await exigirPermiso(['ssoma.ver', 'ssoma.gestionar'])
  // El mismo permiso que piden `ssoma_registrar_entregas_epp`, `ssoma_epp_no_se_renueva` y `ssoma_personal_para_epp`.
  const gestiona = puede(perfil, 'ssoma.gestionar')
  const params = await searchParams
  const vista = params.vista === 'personas' ? 'personas' : params.vista === 'salidas' ? 'salidas' : 'renovar'

  const [porRenovar, salidas, personas, personal] = await Promise.all([
    entregasDeEpp({ porRenovar: true }),
    salidasDeEpp(),
    vista === 'personas' ? eppPorPersona() : Promise.resolve([]),
    gestiona && vista === 'salidas' ? personalParaEpp() : Promise.resolve([]),
  ])

  const vencidas = porRenovar.filter((e) => e.situacion === 'VENCIDA').length
  // Lo que espera por SSOMA: equipo fuera de Almacén sin dueño anotado, salvo lo que ya dijo que no va por persona.
  const porAsignar = salidas.filter(esperaReparto).length
  const resumen = [
    porRenovar.length === 0
      ? 'Nada por renovar'
      : `${porRenovar.length} por renovar${vencidas > 0 ? `, ${vencidas} ${vencidas === 1 ? 'vencido' : 'vencidos'}` : ''}`,
    porAsignar > 0 ? `${porAsignar} ${porAsignar === 1 ? 'salida de Almacén por asignar' : 'salidas de Almacén por asignar'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <EncabezadoPagina
        titulo="EPP por persona"
        descripcion={<span data-resumen-epp>{resumen}</span>}
        ayuda={`El equipo de protección sale de Almacén como siempre, con su número de salida. Aquí SSOMA anota a quién le tocó, cuánto y hasta cuándo le dura; lo vencido y lo que vence en ${DIAS_DE_AVISO_EPP} días sale en «Por renovar». Una entrega anotada no se edita ni se borra: si quedó mal, SSOMA la anula con su motivo.`}
        migas={[{ titulo: 'SSOMA', ruta: '/ssoma' }, { titulo: 'EPP por persona' }]}
        estado={gestiona ? <EstadoDeLaEntrega /> : undefined}
      />

      {/* Lo que espera por SSOMA: equipo que Almacén ya entregó y nadie anotó a quién. */}
      {gestiona && porAsignar > 0 && vista !== 'salidas' && (
        <p role="note" className="mb-3 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-4 py-3 text-sm text-texto" data-epp-por-asignar={porAsignar}>
          Almacén entregó equipo que falta anotar a quién le tocó:{' '}
          <Link href="/ssoma/epp?vista=salidas" className="font-medium underline underline-offset-2">
            {porAsignar === 1 ? 'ver la salida por asignar' : `ver las ${porAsignar} salidas por asignar`}
          </Link>
          .
        </p>
      )}

      <Vistas
        etiqueta="Vista"
        className="mb-3"
        vistas={[
          { clave: 'renovar', titulo: 'Por renovar', href: '/ssoma/epp', activa: vista === 'renovar', cuenta: porRenovar.length },
          { clave: 'personas', titulo: 'Por persona', href: '/ssoma/epp?vista=personas', activa: vista === 'personas' },
          { clave: 'salidas', titulo: 'Salidas de Almacén', href: '/ssoma/epp?vista=salidas', activa: vista === 'salidas', cuenta: salidas.length },
        ]}
      />

      {vista === 'renovar' && (
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Por renovar"
            ayuda={`El equipo vigente de quien sigue en la planta que ya venció o vence en los próximos ${DIAS_DE_AVISO_EPP} días, lo más atrasado primero. Sale de la lista cuando se le anota una entrega nueva del mismo equipo, o cuando SSOMA dice que ya no se renueva.`}
          />
          <TablaPorRenovar entregas={porRenovar} gestiona={gestiona} />
          {porRenovar.length >= MAXIMO_ENTREGAS_EPP && (
            <p className="border-t border-borde px-4 py-3 text-xs text-texto-suave" data-tope-por-renovar>
              Se ven las {MAXIMO_ENTREGAS_EPP} más atrasadas: hay más por renovar que no entran en esta lista.
            </p>
          )}
        </Tarjeta>
      )}

      {vista === 'personas' && (
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Personal en la planta"
            descripcion={personas.length === 0 ? undefined : resumenDePersonas(personas)}
            ayuda="La lista de RR. HH., con el equipo que cada persona tiene vigente. De cada persona se lee solo nombre, cargo y área."
          />
          <TablaDePersonas personas={personas} />
        </Tarjeta>
      )}

      {vista === 'salidas' && (
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Salidas del almacén de EPP"
            descripcion="Las de los últimos 60 días, y hasta 180 las que tienen algo por asignar; las que esperan que se anote a quién, primero"
            ayuda="Cada salida la registra Almacén, con su número y quién recibió. Aquí no se cambia: SSOMA anota a qué personas les tocó. Lo que vuelve a Almacén deja de contar, y lo que no es de nadie en particular (las lunas del área, un polo para una visita) se marca «No va por persona» con su motivo."
          />
          <TablaDeSalidas salidas={salidas} personal={personal} gestiona={gestiona} />
        </Tarjeta>
      )}
    </>
  )
}

/** La salida que todavía espera que SSOMA anote a quién le tocó. */
function esperaReparto(s: SalidaDeEpp) {
  return s.por_asignar > 0 && !s.sin_reparto
}

function resumenDePersonas(personas: PersonaConEpp[]) {
  const con = personas.filter((p) => p.vigentes > 0).length
  return `${personas.length} ${personas.length === 1 ? 'persona' : 'personas'} · ${con} con EPP anotado`
}

/** El equipo y cuánto: «Casco de seguridad», «Guantes de cuero · 2 PAR». */
function Equipo({ e }: { e: { material: string; cantidad: number; unidad: string | null } }) {
  return (
    <>
      {e.material}
      {e.cantidad !== 1 && (
        <span className="tabular text-texto-suave">
          {' '}
          · {cantidad(e.cantidad)} {e.unidad ?? ''}
        </span>
      )}
    </>
  )
}

function TablaPorRenovar({ entregas, gestiona }: { entregas: EntregaDeEpp[]; gestiona: boolean }) {
  if (entregas.length === 0) {
    return (
      <div className="px-4 pb-4" data-nada-por-renovar>
        <SinDatos
          compacto
          titulo="Nada por renovar"
          descripcion={`Cuando el equipo de alguien venza o le falten ${DIAS_DE_AVISO_EPP} días o menos, sale aquí.`}
        />
      </div>
    )
  }
  // Apilada: en el teléfono cada entrega es una ficha y su botón se pinta una sola vez (guarda su ventana y su envío).
  return (
    <Tabla apilada>
      <TablaCabecera>
        <tr>
          <TH>Persona</TH>
          <TH className="hidden md:table-cell">Equipo</TH>
          <TH className="hidden lg:table-cell">Entregado</TH>
          <TH className="hidden md:table-cell">Renovación</TH>
          {gestiona && (
            <TH className="md:w-40">
              <span className="sr-only">Acciones</span>
            </TH>
          )}
        </tr>
      </TablaCabecera>
      <tbody>
        {entregas.map((e) => (
          <TR key={e.id} data-por-renovar={e.id} data-situacion={e.situacion ?? undefined}>
            <TD className="align-top">
              <Link href={`/ssoma/epp/${e.trabajador_id}`} className={ENLACE}>
                {e.persona}
              </Link>
              <p className="text-xs text-texto-suave">{[e.cargo, e.area].filter(Boolean).join(' · ')}</p>
              {/* En el teléfono, lo demás va aquí: la ficha no se desliza de costado. */}
              <div className="mt-1.5 space-y-1.5 md:hidden">
                <p className="text-sm text-texto">
                  <Equipo e={e} />
                </p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-texto-suave">
                  <Insignia tono={tonoDeRenovacion(e.situacion)}>{cuandoSeRenueva(e.dias)}</Insignia>
                  <span className="tabular">renovar el {fecha(e.renovar_el)}</span>
                </p>
              </div>
            </TD>
            <TD className="hidden align-top text-sm text-texto md:table-cell">
              <Equipo e={e} />
            </TD>
            <TD className="hidden align-top lg:table-cell">
              <p className="tabular text-sm whitespace-nowrap text-texto">{fecha(e.entregado_el)}</p>
              {e.numero_salida && <p className="tabular text-xs whitespace-nowrap text-texto-suave">{e.numero_salida}</p>}
            </TD>
            <TD className="hidden align-top md:table-cell">
              <p className="tabular text-sm whitespace-nowrap text-texto">{fecha(e.renovar_el)}</p>
              <p className="mt-1">
                <Insignia tono={tonoDeRenovacion(e.situacion)}>{cuandoSeRenueva(e.dias)}</Insignia>
              </p>
            </TD>
            {gestiona && (
              <TD className="align-top">
                <AccionesDeFila>
                  <NoSeRenueva entrega={e} />
                </AccionesDeFila>
              </TD>
            )}
          </TR>
        ))}
      </tbody>
    </Tabla>
  )
}

/** Lo que tiene por renovar una persona, en insignias; nada si está al día. */
function PorRenovarDe({ p }: { p: PersonaConEpp }) {
  return (
    <>
      {p.vencidas > 0 && (
        <Insignia tono="peligro">
          {p.vencidas} {p.vencidas === 1 ? 'vencido' : 'vencidos'}
        </Insignia>
      )}
      {p.por_vencer > 0 && (
        <Insignia tono="aviso">
          {p.por_vencer} por vencer
        </Insignia>
      )}
    </>
  )
}

function TablaDePersonas({ personas }: { personas: PersonaConEpp[] }) {
  if (personas.length === 0) {
    return (
      <div className="px-4 pb-4">
        <SinDatos
          compacto
          titulo="RR. HH. no tiene a nadie activo en su lista"
          descripcion="Sin la lista del personal no hay a quién anotarle una entrega: pídele a RR. HH. que registre a su gente."
        />
      </div>
    )
  }
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Persona</TH>
          <TH className="hidden sm:table-cell">Área</TH>
          <TH className="hidden sm:table-cell">EPP vigente</TH>
          <TH className="hidden sm:table-cell">Próxima renovación</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {personas.map((p) => (
          <TR key={p.id} data-persona-con-epp={p.id} data-vigentes={p.vigentes}>
            <TD className="align-top">
              <Link href={`/ssoma/epp/${p.id}`} className={ENLACE}>
                {p.persona}
              </Link>
              {p.cargo && <p className="text-xs text-texto-suave">{p.cargo}</p>}
              <DetalleEnTelefono>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-texto-suave">
                  <span>{p.area ?? 'Sin área'}</span>
                  <span>·</span>
                  <span>{p.vigentes === 0 ? 'sin EPP anotado' : `${p.vigentes} ${p.vigentes === 1 ? 'equipo vigente' : 'equipos vigentes'}`}</span>
                  <PorRenovarDe p={p} />
                  {p.proxima && <span className="tabular">· próxima renovación el {fecha(p.proxima)}</span>}
                </p>
              </DetalleEnTelefono>
            </TD>
            <TD className="hidden align-top text-sm text-texto sm:table-cell">{p.area ?? '—'}</TD>
            <TD className="hidden align-top sm:table-cell">
              {p.vigentes === 0 ? (
                <p className="text-sm text-texto-suave">Sin EPP anotado</p>
              ) : (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-texto">
                  <span className="tabular">
                    {p.vigentes} {p.vigentes === 1 ? 'equipo' : 'equipos'}
                  </span>
                  <PorRenovarDe p={p} />
                </p>
              )}
            </TD>
            <TD className="hidden align-top sm:table-cell">
              <p className="tabular text-sm whitespace-nowrap text-texto">{p.proxima ? fecha(p.proxima) : '—'}</p>
            </TD>
          </TR>
        ))}
      </tbody>
    </Tabla>
  )
}

/** En qué va una salida: lo que falta anotar, lo que sobra o que ya está repartida. */
function EstadoDeSalida({ s }: { s: SalidaDeEpp }) {
  const unidad = s.unidad ?? ''
  if (s.asignado_de_mas > 0) {
    return (
      <Insignia tono="peligro">
        Asignado de más: {cantidad(s.asignado_de_mas)} {unidad}
      </Insignia>
    )
  }
  if (s.por_asignar > 0 && s.sin_reparto) {
    return (
      <Insignia tono="neutro">
        No va por persona: {cantidad(s.por_asignar)} {unidad}
      </Insignia>
    )
  }
  if (s.por_asignar > 0) {
    return (
      <Insignia tono="aviso">
        Por asignar: {cantidad(s.por_asignar)} {unidad}
      </Insignia>
    )
  }
  if (s.asignado > 0) return <Insignia tono="exito">Asignada</Insignia>
  return <Insignia tono="neutro">Volvió a Almacén</Insignia>
}

function TablaDeSalidas({ salidas, personal, gestiona }: {
  salidas: SalidaDeEpp[]
  personal: PersonaParaMarcar[]
  gestiona: boolean
}) {
  if (salidas.length === 0) {
    return (
      <div className="px-4 pb-4" data-sin-salidas-epp>
        <SinDatos
          compacto
          titulo="Almacén no registró salidas de EPP en los últimos 60 días"
          descripcion={
            gestiona
              ? 'Cuando Almacén entregue un equipo de protección, sale aquí para anotar a quién le tocó.'
              : 'Cuando Almacén entregue un equipo de protección, sale aquí y SSOMA anota a quién le tocó.'
          }
        />
      </div>
    )
  }
  // Apilada: en el teléfono cada salida es una ficha y «Anotar a quién» se pinta una sola vez.
  return (
    <Tabla apilada>
      <TablaCabecera>
        <tr>
          <TH>Salida</TH>
          <TH className="hidden md:table-cell">Cantidad</TH>
          <TH className="hidden xl:table-cell xl:min-w-56">A quién le tocó</TH>
          {gestiona && (
            <TH className="md:w-80">
              <span className="sr-only">Acciones</span>
            </TH>
          )}
        </tr>
      </TablaCabecera>
      <tbody>
        {salidas.map((s) => {
          // A quién le tocó viene con la salida misma (sin las anuladas): leído aparte y con tope, las
          // salidas más antiguas decían «Todavía nadie» junto a «Asignada».
          const quienes = s.a_quien
          const unidad = s.unidad ?? ''
          const aQuien = <AQuienLeToco entregas={quienes} unidad={unidad} />
          const sinReparto = s.sin_reparto && s.por_asignar > 0
          const porQue = sinReparto && (
            <p className="mt-1 max-w-md text-xs text-pretty text-texto-suave" data-motivo-sin-reparto>
              {s.motivo_sin_reparto}
              {s.dijo_sin_reparto ? ` (${s.dijo_sin_reparto})` : ''}
            </p>
          )
          const deMas = s.asignado_de_mas > 0 && (
            <p className="mt-1 max-w-md text-xs text-pretty text-peligro">
              Volvió a Almacén más de lo que quedaba sin asignar: {gestiona ? 'anula' : 'falta anular'} la entrega de quien lo devolvió, desde su hoja.
            </p>
          )
          return (
            <TR
              key={s.movimiento_id}
              data-salida-epp={s.movimiento_id}
              data-por-asignar={s.por_asignar}
              data-sin-reparto={sinReparto || undefined}
              data-asignado-de-mas={s.asignado_de_mas || undefined}
            >
              <TD className="align-top">
                <p className="text-sm font-medium text-texto">{s.material}</p>
                <p className="text-xs text-texto-suave">
                  <span className="tabular">{s.numero ?? 'Sin número'}</span> · <span className="tabular">{fecha(s.fecha)}</span>
                  {s.recibio ? ` · recibió ${s.recibio}` : ''}
                </p>
                {/* En el teléfono, la cantidad y en qué va bajan aquí. */}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-texto-suave md:hidden">
                  <span className="tabular">
                    {cantidad(s.cantidad)} {unidad}
                    {s.devuelto > 0 ? ` · volvió ${cantidad(s.devuelto)}` : ''}
                  </span>
                  <EstadoDeSalida s={s} />
                </p>
                <div className="md:hidden">{porQue}</div>
                {/* Por debajo de 1280 px no hay columna de «A quién»: va aquí. */}
                <div className="xl:hidden">
                  {quienes.length > 0 && <div className="mt-1.5 text-xs">{aQuien}</div>}
                  {deMas}
                </div>
              </TD>
              <TD className="hidden align-top md:table-cell">
                <p className="tabular text-sm whitespace-nowrap text-texto">
                  {cantidad(s.cantidad)} {unidad}
                </p>
                {s.devuelto > 0 && <p className="tabular text-xs whitespace-nowrap text-texto-suave">volvió {cantidad(s.devuelto)} a Almacén</p>}
                <p className="mt-1">
                  <EstadoDeSalida s={s} />
                </p>
                {porQue}
              </TD>
              <TD className="hidden align-top text-sm xl:table-cell">
                {quienes.length === 0 ? <p className="text-texto-suave">{sinReparto ? 'Nadie en particular' : 'Todavía nadie'}</p> : aQuien}
                {deMas}
              </TD>
              {gestiona && (
                <TD className="align-top">
                  {sinReparto ? (
                    <AccionesDeFila>
                      <RepartirSalida salida={s} />
                    </AccionesDeFila>
                  ) : (
                    s.por_asignar > 0 && (
                      <AccionesDeFila>
                        <AsignarEpp salida={s} personal={personal} />
                        <NoVaPorPersona salida={s} />
                      </AccionesDeFila>
                    )
                  )}
                </TD>
              )}
            </TR>
          )
        })}
      </tbody>
    </Tabla>
  )
}

/** Las personas de una salida, cada una con el enlace a su hoja y cuánto se llevó. */
function AQuienLeToco({ entregas, unidad }: { entregas: PersonaDeLaSalida[]; unidad: string }) {
  return (
    <ul className="xl:space-y-0.5">
      {entregas.map((e) => (
        <li key={e.id}>
          {/* Subrayado, para que se lea como enlace; en el teléfono, con el alto de un dedo. */}
          <Link
            href={`/ssoma/epp/${e.trabajador_id}`}
            className="inline-flex min-h-11 items-center text-texto underline decoration-borde-fuerte underline-offset-2 hover:text-acento xl:min-h-0"
          >
            {e.persona}
          </Link>
          {e.cantidad !== 1 && (
            <span className="tabular text-texto-suave">
              {' '}
              · {cantidad(e.cantidad)} {unidad}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
