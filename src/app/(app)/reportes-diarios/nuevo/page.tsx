import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { opcionesDeTrabajo, personalParaReporte, reporteDiario } from '@/lib/datos/reportes-diarios'
import { codigosInternos } from '@/lib/datos/rrhh'
import { CODIGO_SIN_AVANCE, normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { AREA_QUE_VALIDA, DIAS_PARA_EL_REPORTE, MAXIMO_CODIGOS_REPORTE, estadoDeReporte } from '@/lib/dominio/reporte-diario'
import { hoyLima, sumarDias } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioReporteDiario, type OpcionPersona, type ReporteACorregir } from './formulario'

export const metadata = { title: 'Nuevo reporte diario' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaNuevoReporte({ searchParams }: PageProps<'/reportes-diarios/nuevo'>) {
  const perfil = await exigirPermiso('reporte_diario.registrar')
  const hoy = hoyLima()
  const { corrige: idCorrige, codigo: codigoPedido, subcontrato: subcontratoPedido } = await searchParams
  // Desde Subcontratos, «Reportar avance» abre el reporte con su código escrito
  // y el subcontrato elegido.
  const codigoInicial =
    typeof idCorrige !== 'string' && typeof codigoPedido === 'string' && codigoPedido.trim().length >= 2
      ? codigoPedido.trim().slice(0, 60).toUpperCase()
      : ''
  const subcontratoInicial = typeof subcontratoPedido === 'string' && GUID.test(subcontratoPedido) ? subcontratoPedido : null
  // Lo que se puede elegir en ese código se lee junto con lo demás. Si falla, el
  // formulario lo dice: una lista vacía diría que el código no tiene nada.
  const [personal, codigos, observado, leidas] = await Promise.all([
    personalParaReporte(),
    codigosInternos(),
    typeof idCorrige === 'string' && GUID.test(idCorrige) ? reporteDiario(idCorrige, false) : Promise.resolve(null),
    codigoInicial
      ? opcionesDeTrabajo(codigoInicial, null, hoy).then(
          (opciones) => ({ opciones, error: null }),
          () => ({ opciones: [], error: `No se pudo leer lo que tiene ${codigoInicial}. Vuelve a escribir el código o recarga la página.` }),
        )
      : Promise.resolve({ opciones: [], error: null }),
  ])

  // Se corrige solo un reporte propio que Gerencia o RR. HH. observaron y que
  // nadie anuló todavía: lo mismo que exige `registrar_reporte_corregido`.
  const pidioCorregir = typeof idCorrige === 'string'
  const sePuede = observado && observado.registrado_por === perfil.id && estadoDeReporte(observado) === 'OBSERVADO'
  if (pidioCorregir && !sePuede) {
    return (
      <>
        <EncabezadoPagina titulo="Corregir el reporte" migas={[{ titulo: 'Reporte diario', ruta: '/reportes-diarios' }, { titulo: 'Corregir' }]} />
        <Tarjeta className="max-w-3xl">
          <TarjetaCuerpo className="space-y-3">
            <p className="text-sm text-texto">
              {observado && observado.corregido_por
                ? 'Ese reporte ya lo corregiste y subiste de nuevo.'
                : 'Ese reporte no se puede corregir: solo se corrigen los tuyos que Gerencia o Recursos Humanos observaron.'}
            </p>
            <EnlaceBoton href={observado?.corregido_por ? `/reportes-diarios/${observado.corregido_por}` : '/reportes-diarios'} variante="contorno" tamano="sm">
              {observado?.corregido_por ? 'Ver el reporte corregido' : 'Volver a los reportes'}
            </EnlaceBoton>
          </TarjetaCuerpo>
        </Tarjeta>
      </>
    )
  }

  const corrige: ReporteACorregir | null = sePuede
    ? {
        reemplaza: observado.id,
        fecha: observado.fecha,
        codigo_interno: observado.codigo_interno,
        asunto: observado.asunto,
        descripcion: observado.descripcion,
        general: observado.personal_general,
        trabajos: observado.trabajos.map((t) => ({
          // Sigue sobre lo mismo: el plano, el subcontrato o la actividad del observado.
          sobre: t.plano_id
            ? `PLANO:${t.plano_id}`
            : t.subcontrato_id
              ? `SUBCONTRATO:${t.subcontrato_id}`
              : // PLANTA no lleva avance ni actividades que sigan: su trabajo va suelto.
                t.actividad_id && normalizarCodigo(observado.codigo_interno) !== CODIGO_SIN_AVANCE
                ? `ACTIVIDAD:${t.actividad_id}`
                : 'NUEVA',
          descripcion: t.descripcion,
          avance: t.avance,
          personal: observado.personal.filter((p) => p.trabajo_id === t.id).map((p) => ({ trabajador_id: p.trabajador_id, horas: p.horas })),
        })),
        personal_general: observado.personal
          .filter((p) => p.trabajo_id === null)
          .map((p) => ({ trabajador_id: p.trabajador_id, horas: p.horas })),
        fotos: observado.fotos.map((f) => ({ ruta: f.ruta, enlace: f.enlace })),
      }
    : null
  // Al corregir, lo que se puede elegir se cuenta sin el observado, que se va a reemplazar.
  const opcionesIniciales = corrige ? await opcionesDeTrabajo(corrige.codigo_interno, corrige.reemplaza, corrige.fecha) : leidas.opciones
  // El corregido conserva su día aunque ya pasaran los 7: la base lo deja.
  const minimo = sumarDias(hoy, -DIAS_PARA_EL_REPORTE)

  // La gente del área del supervisor primero: es la que casi siempre pone.
  const opciones: OpcionPersona[] = [...personal]
    .sort((a, b) => Number(b.area_id === perfil.area_id) - Number(a.area_id === perfil.area_id))
    .map((p) => ({
      valor: p.id,
      etiqueta: `${p.apellidos}, ${p.nombres}`,
      detalle: [p.cargo, p.area].filter(Boolean).join(' · ') || null,
    }))
  // Quien iba en el observado y ya no sale en la lista (RR. HH. lo pasó a la
  // planilla administrativa o a otra área) se sigue viendo con su nombre: la
  // corrección lo conserva, y la base lo deja solo por venir del observado.
  if (corrige) {
    const enLista = new Set(opciones.map((o) => o.valor))
    for (const p of observado?.personal ?? []) {
      if (enLista.has(p.trabajador_id)) continue
      enLista.add(p.trabajador_id)
      opciones.push({ valor: p.trabajador_id, etiqueta: p.nombre, detalle: 'Ya no está en la planilla de taller' })
    }
  }

  return (
    <>
      <EncabezadoPagina
        titulo={corrige ? 'Corregir el reporte' : 'Nuevo reporte diario'}
        ayuda={
          corrige
            ? 'Se abre con lo que ya subiste y sus fotos. Corrige lo observado y súbelo: el observado queda anulado con la observación como motivo, y Gerencia y Recursos Humanos validan este.'
            : 'Lo que hizo tu gente en el día: en cada código interno, qué se hizo, cuánto avanzó, quién trabajó y cuántas horas. Si trabajaron en varios códigos, agrega cada uno al mismo reporte. Se guarda un reporte por código y las horas pasan solas al costeo de cada uno.'
        }
        migas={[{ titulo: 'Reporte diario', ruta: '/reportes-diarios' }, { titulo: corrige ? 'Corregir' : 'Nuevo' }]}
      />
      {corrige && observado?.observacion && (
        <p className="mb-4 max-w-3xl rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-observacion>
          <span className="font-medium">Lo que observó {AREA_QUE_VALIDA[observado.observacion_area ?? 'RRHH']}:</span> {observado.observacion}
        </p>
      )}
      <Tarjeta className="max-w-3xl">
        <TarjetaCuerpo>
          <FormularioReporteDiario
            ids={Array.from({ length: corrige ? 1 : MAXIMO_CODIGOS_REPORTE }, () => crypto.randomUUID())}
            cuentaId={perfil.id}
            hoy={hoy}
            minimo={corrige && corrige.fecha < minimo ? corrige.fecha : minimo}
            personal={opciones}
            codigos={codigos}
            corrige={corrige}
            codigoInicial={corrige ? '' : codigoInicial}
            opcionesIniciales={opcionesIniciales}
            errorOpcionesIniciales={corrige ? null : leidas.error}
            subcontratoInicial={corrige ? null : subcontratoInicial}
          />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
