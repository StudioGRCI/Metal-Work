import { Camera, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { listarCharlasDelMes, noAsistieronEnElMes, personalParaCharla, type CharlaSsoma, type FaltoEnElMes } from '@/lib/datos/ssoma'
import { mesDeLima, mesValido, mesVecino } from '@/lib/dominio/rrhh'
import { TIPO_CHARLA_SSOMA } from '@/lib/dominio/ssoma'
import { fecha, hoyLima, mesLargo } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { EstadoDeLaCharla, RegistrarCharla } from './controles'

export const metadata = { title: 'Seguridad: charlas e inducciones' }

/**
 * Las charlas de seguridad y las inducciones del mes, y quién del personal
 * activo de RR. HH. no asistió a ninguna. SSOMA las registra; Gerencia las
 * consulta. De RR. HH. llega solo nombre, cargo y área: lo decide la base.
 */
export default async function PaginaCharlasSsoma({ searchParams }: PageProps<'/ssoma/charlas'>) {
  // Los mismos permisos con que la base deja leer las charlas (`puede_ver_reportes_ssoma`).
  const perfil = await exigirPermiso(['ssoma.ver', 'ssoma.gestionar'])
  // El mismo permiso que piden `ssoma_registrar_charla` y `ssoma_personal_para_charla`.
  const gestiona = puede(perfil, 'ssoma.gestionar')
  const params = await searchParams
  const hoy = hoyLima()
  const mesActual = mesDeLima(hoy)
  const mes = mesValido(params.mes) && params.mes <= mesActual ? params.mes : mesActual
  const enCurso = mes === mesActual

  const [charlas, { faltaron, activos }, personal] = await Promise.all([
    listarCharlasDelMes(mes),
    noAsistieronEnElMes(mes),
    gestiona ? personalParaCharla() : Promise.resolve([]),
  ])
  const vigentes = charlas.filter((c) => !c.anulado_en)
  const inducciones = vigentes.filter((c) => c.tipo === 'INDUCCION').length
  const nombreDelMes = mesLargo(`${mes}-01`)

  return (
    <>
      <EncabezadoPagina
        titulo="Charlas e inducciones"
        descripcion={gestiona ? 'Registra cada charla con su foto y quiénes asistieron.' : 'Las charlas de seguridad y las inducciones que registra SSOMA.'}
        ayuda="Cada charla o inducción, con su tema, quién la dio, la fecha, las fotos y quiénes asistieron de la lista de RR. HH. Abajo, quién del personal activo no asistió a ninguna en el mes. Una charla registrada no se edita ni se borra: si quedó mal, SSOMA la anula con su motivo y deja de contar."
        migas={[{ titulo: 'SSOMA', ruta: '/ssoma' }, { titulo: 'Charlas e inducciones' }]}
        acciones={
          gestiona && <RegistrarCharla cuentaId={perfil.id} personal={personal} hoy={hoy} expositor={`${perfil.nombres} ${perfil.apellidos}`.trim()} />
        }
        estado={gestiona ? <EstadoDeLaCharla /> : undefined}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Mes" className="flex items-center gap-1">
          <Link
            href={`/ssoma/charlas?mes=${mesVecino(mes, -1)}`}
            aria-label="Mes anterior"
            className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto sm:size-9"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <p className="px-1 text-sm font-medium text-texto first-letter:uppercase" aria-current="date">
            {nombreDelMes}
          </p>
          {!enCurso && (
            <Link
              href={mesVecino(mes, 1) === mesActual ? '/ssoma/charlas' : `/ssoma/charlas?mes=${mesVecino(mes, 1)}`}
              aria-label="Mes siguiente"
              className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto sm:size-9"
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </nav>
        <p className="text-xs text-texto-suave" data-resumen-charlas>
          <span className="tabular">{vigentes.length - inducciones}</span> {vigentes.length - inducciones === 1 ? 'charla' : 'charlas'} ·{' '}
          <span className="tabular">{inducciones}</span> {inducciones === 1 ? 'inducción' : 'inducciones'}
        </p>
      </div>

      <div className="space-y-5">
        <Tarjeta className="overflow-hidden" data-no-asistieron={faltaron.length}>
          <TarjetaCabecera
            titulo={`No asistieron en ${nombreDelMes}`}
            descripcion={
              activos === 0
                ? undefined
                : `${faltaron.length} de ${activos} ${activos === 1 ? 'persona activa' : 'personas activas'}${enCurso ? ' · el mes sigue en curso' : ''}`
            }
            ayuda="El personal activo de RR. HH. que no estuvo en ninguna charla ni inducción vigente del mes. Una charla anulada no cuenta."
          />
          <TablaDeFaltas faltaron={faltaron} activos={activos} mes={nombreDelMes} enCurso={enCurso} />
        </Tarjeta>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo={`Registradas en ${nombreDelMes}`} />
          <TablaDeCharlas
            charlas={charlas}
            vacio={
              gestiona
                ? {
                    titulo: enCurso ? 'Todavía no hay charlas este mes' : 'No se registraron charlas ese mes',
                    descripcion: enCurso ? 'Cuando des la siguiente, toca «Registrar charla» y marca quiénes asistieron.' : '',
                  }
                : { titulo: 'No hay charlas registradas en el mes', descripcion: 'Las registra SSOMA, con su foto y quiénes asistieron.' }
            }
          />
        </Tarjeta>
      </div>
    </>
  )
}

function TablaDeFaltas({ faltaron, activos, mes, enCurso }: { faltaron: FaltoEnElMes[]; activos: number; mes: string; enCurso: boolean }) {
  if (activos === 0) {
    return (
      <div className="px-4 pb-4">
        <SinDatos compacto titulo="RR. HH. no tiene personal activo" descripcion="Sin la lista del personal no hay a quién contar." />
      </div>
    )
  }
  if (faltaron.length === 0) {
    return (
      <div className="px-4 pb-4">
        <SinDatos
          compacto
          titulo={enCurso ? 'Este mes ya asistieron todos' : `En ${mes} asistieron todos`}
          descripcion="Cada persona activa estuvo en al menos una charla o inducción."
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
          <TH className="hidden sm:table-cell">Su última charla</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {faltaron.map((p) => (
          <TR key={p.id} data-falto={p.id}>
            <TD className="align-top">
              <p className="text-sm text-texto">{p.nombre}</p>
              {p.cargo && <p className="text-xs text-texto-suave">{p.cargo}</p>}
              <p className="mt-0.5 text-xs text-texto-suave sm:hidden">
                {[p.area, p.ultima ? `última charla el ${fecha(p.ultima)}` : 'ninguna charla registrada'].filter(Boolean).join(' · ')}
              </p>
            </TD>
            <TD className="hidden align-top text-sm text-texto sm:table-cell">{p.area ?? '—'}</TD>
            <TD className="hidden align-top sm:table-cell">
              <p className={cn('tabular text-xs whitespace-nowrap', p.ultima ? 'text-texto' : 'text-texto-suave')}>
                {p.ultima ? fecha(p.ultima) : 'Ninguna registrada'}
              </p>
            </TD>
          </TR>
        ))}
      </tbody>
    </Tabla>
  )
}

function TablaDeCharlas({ charlas, vacio }: { charlas: CharlaSsoma[]; vacio: { titulo: string; descripcion: string } }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Charla</TH>
          <TH className="hidden sm:table-cell">Fecha</TH>
          <TH className="hidden sm:table-cell">Quién la dio</TH>
          <TH className="hidden text-right sm:table-cell">Asistentes</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {charlas.length === 0 ? (
          <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
        ) : (
          charlas.map((c) => <FilaCharla key={c.id} charla={c} />)
        )}
      </tbody>
    </Tabla>
  )
}

function FilaCharla({ charla: c }: { charla: CharlaSsoma }) {
  const tipo = TIPO_CHARLA_SSOMA[c.tipo]
  const anulada = Boolean(c.anulado_en)
  return (
    <TR data-charla={c.id} data-anulada={anulada || undefined}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : c.tipo}
          {anulada && <Insignia tono="neutro">Anulada</Insignia>}
        </div>
        <Link
          href={`/ssoma/charlas/${c.id}`}
          className={cn(
            'mt-1 inline-flex min-h-11 items-center text-sm font-medium text-texto hover:text-acento hover:underline sm:min-h-0',
            anulada && 'text-texto-suave line-through',
          )}
        >
          <span className="line-clamp-2 max-w-xl">{c.tema}</span>
        </Link>
        {c.fotos > 0 && (
          <p className="mt-0.5 hidden items-center gap-1 text-xs text-texto-suave sm:flex">
            <Camera aria-hidden className="size-3.5" />
            {c.fotos} {c.fotos === 1 ? 'foto' : 'fotos'}
          </p>
        )}
        {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
        <p className="mt-0.5 text-xs text-texto-suave sm:hidden">
          <span className="tabular">{fecha(c.fecha)}</span> · {c.expositor}
        </p>
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-texto-suave sm:hidden">
          <Users aria-hidden className="size-3.5" />
          <span className="tabular">{c.asistentes}</span> {c.asistentes === 1 ? 'asistente' : 'asistentes'}
        </p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs whitespace-nowrap text-texto">{fecha(c.fecha)}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="text-sm text-texto">{c.expositor}</p>
      </TD>
      <TD className="hidden text-right align-top sm:table-cell">
        <p className="tabular text-sm text-texto">{c.asistentes}</p>
      </TD>
    </TR>
  )
}
