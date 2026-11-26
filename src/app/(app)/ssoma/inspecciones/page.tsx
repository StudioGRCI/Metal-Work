import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  areasParaInspeccionar,
  cuentasParaAsignar,
  inspeccionesPorArea,
  listarInspeccionesSsoma,
  MAXIMO_INSPECCIONES_SSOMA,
  puntosDeLaLista,
  type AreaInspeccionada,
  type AreaParaInspeccionar,
  type InspeccionSsoma,
  type PuntoDeLista,
} from '@/lib/datos/ssoma'
import { TIPO_INSPECCION_SSOMA } from '@/lib/dominio/ssoma'
import { fecha, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { AgregarPunto, CambiarPunto, EstadoDeLaInspeccion, EstadoDeLaLista, NuevaInspeccion } from './controles'

export const metadata = { title: 'Seguridad: inspecciones' }

/**
 * Las inspecciones de seguridad: cuándo se revisó cada área, qué se encontró y
 * cómo van las acciones que salieron de ahí; y la lista de verificación con que
 * se inspecciona. SSOMA las registra y mantiene la lista; Gerencia consulta.
 */
export default async function PaginaInspeccionesSsoma({ searchParams }: PageProps<'/ssoma/inspecciones'>) {
  // Los mismos permisos con que la base deja leer las inspecciones (`puede_ver_reportes_ssoma`).
  const perfil = await exigirPermiso(['ssoma.ver', 'ssoma.gestionar'])
  // El mismo permiso que piden `ssoma_registrar_inspeccion`, `ssoma_agregar_punto` y `ssoma_activar_punto`.
  const gestiona = puede(perfil, 'ssoma.gestionar')
  const params = await searchParams
  const enLista = params.vista === 'lista'
  const hoy = hoyLima()

  const [inspecciones, porArea, puntos, areas, cuentas] = await Promise.all([
    listarInspeccionesSsoma(),
    inspeccionesPorArea(),
    puntosDeLaLista(),
    gestiona ? areasParaInspeccionar() : Promise.resolve([]),
    gestiona ? cuentasParaAsignar() : Promise.resolve([]),
  ])
  const vigentes = inspecciones.filter((i) => !i.anulado_en)
  const activos = puntos.filter((p) => p.activo)
  const abiertas = porArea.reduce((n, a) => n + a.abiertas, 0)
  const vencidas = porArea.reduce((n, a) => n + a.vencidas, 0)
  const resumen = enLista
    ? `${activos.length} ${activos.length === 1 ? 'punto vigente' : 'puntos vigentes'}`
    : `${abiertas} ${abiertas === 1 ? 'acción abierta' : 'acciones abiertas'}${vencidas > 0 ? `, ${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'}` : ''}`

  return (
    <>
      <EncabezadoPagina
        titulo="Inspecciones"
        descripcion={<span data-resumen-inspecciones>{resumen}</span>}
        ayuda="Cada inspección de un área, con su lista de verificación: qué estaba conforme y qué no. De cada punto no conforme sale una acción correctiva, con su responsable y su fecha. Una inspección registrada no se edita ni se borra: si quedó mal, SSOMA la anula con su motivo."
        migas={[{ titulo: 'SSOMA', ruta: '/ssoma' }, { titulo: 'Inspecciones' }]}
        acciones={
          gestiona &&
          (enLista ? <AgregarPunto areas={areas} /> : <NuevaInspeccion areas={areas} puntos={activos} cuentas={cuentas} hoy={hoy} />)
        }
        estado={gestiona ? enLista ? <EstadoDeLaLista /> : <EstadoDeLaInspeccion /> : undefined}
      />

      <Vistas
        etiqueta="Vista"
        className="mb-3"
        vistas={[
          { clave: 'inspecciones', titulo: 'Inspecciones', href: '/ssoma/inspecciones', activa: !enLista, cuenta: vigentes.length },
          { clave: 'lista', titulo: 'Lista de verificación', href: '/ssoma/inspecciones?vista=lista', activa: enLista, cuenta: activos.length },
        ]}
      />

      {enLista ? (
        <ListaDeVerificacion puntos={puntos} areas={porArea} gestiona={gestiona} />
      ) : (
        <div className="space-y-5">
          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera
              titulo="Por área"
              ayuda="La última inspección vigente de cada área y las acciones correctivas que siguen abiertas de sus inspecciones. Una inspección anulada no cuenta."
            />
            <TablaPorArea areas={porArea} />
          </Tarjeta>

          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera
              titulo="Registradas"
              descripcion={
                inspecciones.length >= MAXIMO_INSPECCIONES_SSOMA ? `Las ${MAXIMO_INSPECCIONES_SSOMA} más recientes` : undefined
              }
            />
            <TablaDeInspecciones inspecciones={inspecciones} gestiona={gestiona} />
          </Tarjeta>
        </div>
      )}
    </>
  )
}

/** Las áreas ya inspeccionadas, o con acciones abiertas, a la vista; las demás, plegadas: son la mayoría al empezar. */
function TablaPorArea({ areas }: { areas: AreaInspeccionada[] }) {
  const vistas = areas.filter((a) => a.ultima || a.abiertas > 0)
  const sinInspeccionar = areas.filter((a) => !a.ultima && a.abiertas === 0)
  if (areas.length === 0) {
    return (
      <div className="px-4 pb-4">
        <SinDatos compacto titulo="No hay áreas activas" descripcion="Las áreas las mantiene el administrador." />
      </div>
    )
  }
  return (
    <>
      {vistas.length === 0 ? (
        <div className="px-4 pb-4" data-ninguna-inspeccionada>
          <SinDatos compacto titulo="Todavía no se inspeccionó ningún área" descripcion="Cuando se registre la primera, aquí sale cuándo fue y cómo van sus acciones." />
        </div>
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Área</TH>
              <TH className="hidden sm:table-cell">Última inspección</TH>
              <TH className="hidden text-right sm:table-cell">Acciones abiertas</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {vistas.map((a) => (
              <TR key={a.area_id} data-area-inspeccionada={a.area_id} data-dias={a.dias ?? undefined}>
                <TD className="align-top">
                  <p className="text-sm font-medium text-texto">{a.area}</p>
                  {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
                  <div className="mt-0.5 space-y-0.5 text-xs text-texto-suave sm:hidden">
                    <p>
                      <UltimaInspeccion area={a} />
                    </p>
                    <p>
                      <AccionesAbiertas abiertas={a.abiertas} vencidas={a.vencidas} />
                    </p>
                  </div>
                </TD>
                <TD className="hidden align-top text-sm sm:table-cell">
                  <UltimaInspeccion area={a} />
                </TD>
                <TD className="hidden text-right align-top text-sm sm:table-cell">
                  <AccionesAbiertas abiertas={a.abiertas} vencidas={a.vencidas} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Tabla>
      )}
      {sinInspeccionar.length > 0 && (
        <div className="border-t border-borde px-4">
          <Pliegue
            titulo={sinInspeccionar.length === 1 ? 'Ver el área sin inspeccionar' : `Ver las ${sinInspeccionar.length} áreas sin inspeccionar`}
            data-areas-sin-inspeccionar={String(sinInspeccionar.length)}
          >
            <ul className="grid gap-x-6 gap-y-1 pb-3 text-sm text-texto sm:grid-cols-2 lg:grid-cols-3">
              {sinInspeccionar.map((a) => (
                <li key={a.area_id} data-area-sin-inspeccionar={a.area_id}>
                  {a.area}
                </li>
              ))}
            </ul>
          </Pliegue>
        </div>
      )}
    </>
  )
}

function haceCuanto(dias: number) {
  return dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`
}

function UltimaInspeccion({ area: a }: { area: AreaInspeccionada }) {
  if (!a.ultima || !a.ultima_id) return <span className="text-texto-suave">Sin inspeccionar</span>
  return (
    <Link
      href={`/ssoma/inspecciones/${a.ultima_id}`}
      className="tabular inline-flex min-h-11 items-center text-texto hover:text-acento hover:underline sm:min-h-0"
    >
      {fecha(a.ultima)}
      {a.dias !== null && <span className="ml-1 text-texto-suave">· {haceCuanto(a.dias)}</span>}
    </Link>
  )
}

function AccionesAbiertas({ abiertas, vencidas }: { abiertas: number; vencidas: number }) {
  if (abiertas === 0) return <span className="text-texto-suave">Ninguna abierta</span>
  return (
    <span className="tabular text-texto">
      <span className="sm:hidden">{abiertas === 1 ? '1 acción abierta' : `${abiertas} acciones abiertas`}</span>
      <span className="hidden sm:inline">{abiertas}</span>
      {vencidas > 0 && (
        <span className="ml-1 font-medium text-peligro">
          · {vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}
        </span>
      )}
    </span>
  )
}

function TablaDeInspecciones({ inspecciones, gestiona }: { inspecciones: InspeccionSsoma[]; gestiona: boolean }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Inspección</TH>
          <TH className="hidden sm:table-cell">Resultado</TH>
          <TH className="hidden sm:table-cell">Acciones</TH>
          <TH className="hidden md:table-cell">Registró</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {inspecciones.length === 0 ? (
          <SinDatos
            titulo="Todavía no hay inspecciones"
            descripcion={
              gestiona
                ? 'Cuando recorras un área, toca «Nueva inspección» y marca cada punto de su lista.'
                : 'Las registra SSOMA, con la lista de verificación de cada área.'
            }
          />
        ) : (
          inspecciones.map((i) => <FilaInspeccion key={i.id} inspeccion={i} />)
        )}
      </tbody>
    </Tabla>
  )
}

function resultadoDe(i: InspeccionSsoma) {
  return i.no_conformes === 0
    ? `${i.puntos} ${i.puntos === 1 ? 'punto' : 'puntos'}, todo conforme`
    : `${i.no_conformes} no ${i.no_conformes === 1 ? 'conforme' : 'conformes'} de ${i.puntos}`
}

function accionesDe(i: InspeccionSsoma) {
  if (i.no_conformes === 0) return null
  const partes = [
    i.vencidas > 0 ? `${i.vencidas} ${i.vencidas === 1 ? 'vencida' : 'vencidas'}` : null,
    i.abiertas - i.vencidas > 0 ? `${i.abiertas - i.vencidas} ${i.abiertas - i.vencidas === 1 ? 'abierta' : 'abiertas'}` : null,
    i.cerradas > 0 ? `${i.cerradas} ${i.cerradas === 1 ? 'cerrada' : 'cerradas'}` : null,
    i.sin_accion > 0 ? `${i.sin_accion} ${i.sin_accion === 1 ? 'hallazgo' : 'hallazgos'} sin acción` : null,
  ].filter(Boolean)
  return partes.join(' · ')
}

function FilaInspeccion({ inspeccion: i }: { inspeccion: InspeccionSsoma }) {
  const tipo = TIPO_INSPECCION_SSOMA[i.tipo]
  const anulada = Boolean(i.anulado_en)
  const acciones = anulada ? null : accionesDe(i)
  const urge = !anulada && (i.vencidas > 0 || i.sin_accion > 0)
  return (
    <TR data-inspeccion={i.id} data-anulada={anulada || undefined}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : i.tipo}
          {anulada && <Insignia tono="neutro">Anulada</Insignia>}
        </div>
        <Link
          href={`/ssoma/inspecciones/${i.id}`}
          className={cn(
            'mt-1 inline-flex min-h-11 items-center text-sm font-medium text-texto hover:text-acento hover:underline sm:min-h-0',
            anulada && 'text-texto-suave line-through',
          )}
        >
          <span>
            {i.area} · <span className="tabular">{fecha(i.fecha)}</span>
          </span>
        </Link>
        {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
        <p className="mt-0.5 text-xs text-texto-suave sm:hidden">{resultadoDe(i)}</p>
        {acciones && <p className={cn('mt-0.5 text-xs sm:hidden', urge ? 'font-medium text-peligro' : 'text-texto-suave')}>{acciones}</p>}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-sm text-texto">{resultadoDe(i)}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className={cn('tabular text-sm', urge ? 'font-medium text-peligro' : acciones ? 'text-texto' : 'text-texto-suave')}>{acciones ?? '—'}</p>
      </TD>
      <TD className="hidden align-top md:table-cell">
        <p className="text-sm text-texto">{i.registro ?? '—'}</p>
      </TD>
    </TR>
  )
}

/** La lista con que se inspecciona: lo de todas las áreas y lo propio de cada una; lo retirado, plegado al final. */
function ListaDeVerificacion({ puntos, areas, gestiona }: { puntos: PuntoDeLista[]; areas: AreaInspeccionada[]; gestiona: boolean }) {
  const vigentes = puntos.filter((p) => p.activo)
  const retirados = puntos.filter((p) => !p.activo)
  const generales = vigentes.filter((p) => p.area_id === null)
  const nombreDe = (id: string | null) => (id === null ? 'Todas las áreas' : (areas.find((a) => a.area_id === id)?.area ?? 'Un área que ya no está activa'))
  // Las áreas con algún punto propio, en el orden del proceso; al final, las que ya no están activas.
  const conPropios = [
    ...areas.map((a) => a.area_id),
    ...vigentes.flatMap((p) => (p.area_id && !areas.some((a) => a.area_id === p.area_id) ? [p.area_id] : [])),
  ].filter((id, i, todas) => todas.indexOf(id) === i && vigentes.some((p) => p.area_id === id))
  return (
    <div className="space-y-5" data-lista-de-verificacion>
      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo={`En todas las áreas · ${generales.length}`}
          ayuda="Lo que se revisa en cada inspección, sea del área que sea. Un punto no se edita: se retira y se agrega otro, para que las inspecciones ya hechas sigan diciendo lo que se revisó."
        />
        <FilasDePuntos
          puntos={generales}
          gestiona={gestiona}
          vacio={{
            titulo: 'No hay puntos para todas las áreas',
            descripcion: gestiona ? 'Toca «Agregar punto» y deja «Todas las áreas».' : 'SSOMA todavía no los definió.',
          }}
        />
      </Tarjeta>

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Propios de un área"
          ayuda="Lo que se revisa solo en esa área, además de lo de todas: en su inspección salen después de los generales."
        />
        {conPropios.length === 0 ? (
          <TarjetaCuerpo>
            <SinDatos
              compacto
              titulo="Ningún área tiene puntos propios"
              descripcion={
                gestiona
                  ? 'Si en un área hay algo particular que revisar (los balones de gas en Soldadura, la cabina en Pintura), agrégalo con «Agregar punto» y elige el área.'
                  : 'Todas se inspeccionan con los puntos de todas las áreas.'
              }
            />
          </TarjetaCuerpo>
        ) : (
          conPropios.map((id) => {
            const suyos = vigentes.filter((p) => p.area_id === id)
            return (
              <section key={id} aria-label={nombreDe(id)} className="border-t border-borde first:border-t-0" data-puntos-del-area={id}>
                <h3 className="px-4 pt-3 text-xs font-medium text-texto-suave">
                  {nombreDe(id)} · <span className="tabular">{suyos.length}</span>
                </h3>
                {/* Con el número que llevan en la inspección de su área: después de los de todas. */}
                <FilasDePuntos puntos={suyos} gestiona={gestiona} desde={generales.length} />
              </section>
            )
          })
        )}
      </Tarjeta>

      {retirados.length > 0 && (
        <Tarjeta>
          <TarjetaCuerpo>
            <Pliegue
              titulo={retirados.length === 1 ? 'Ver el punto retirado' : `Ver los ${retirados.length} puntos retirados`}
              data-puntos-retirados={String(retirados.length)}
            >
              <ul className="divide-y divide-borde">
                {retirados.map((p) => (
                  <FilaPunto key={p.id} punto={p} gestiona={gestiona} donde={nombreDe(p.area_id)} />
                ))}
              </ul>
            </Pliegue>
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </div>
  )
}

function FilasDePuntos({
  puntos,
  gestiona,
  vacio,
  desde = 0,
}: {
  puntos: PuntoDeLista[]
  gestiona: boolean
  vacio?: { titulo: string; descripcion: string }
  /** Cuántos puntos van antes en la inspección: los propios de un área siguen a los de todas. */
  desde?: number
}) {
  if (puntos.length === 0) {
    return vacio ? (
      <div className="px-4 pb-4">
        <SinDatos compacto titulo={vacio.titulo} descripcion={vacio.descripcion} />
      </div>
    ) : null
  }
  return (
    <ol className="divide-y divide-borde px-4 pb-1">
      {puntos.map((p, i) => (
        <FilaPunto key={p.id} punto={p} gestiona={gestiona} numero={desde + i + 1} />
      ))}
    </ol>
  )
}

function FilaPunto({ punto: p, gestiona, numero, donde }: { punto: PuntoDeLista; gestiona: boolean; numero?: number; donde?: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5" data-punto-de-lista={p.id} data-activo={p.activo}>
      <div className="min-w-0">
        <p className={cn('text-sm', p.activo ? 'text-texto' : 'text-texto-suave')}>
          {numero !== undefined && <span className="tabular text-texto-suave">{numero}. </span>}
          {p.texto}
        </p>
        {!p.activo && (
          <p className="tabular mt-0.5 text-xs text-texto-suave">
            {donde}
            {p.retirado_en ? ` · retirado el ${fecha(p.retirado_en)}` : ''}
          </p>
        )}
      </div>
      {gestiona && <CambiarPunto id={p.id} activo={p.activo} texto={p.texto} />}
    </li>
  )
}
