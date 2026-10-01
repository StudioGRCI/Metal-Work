import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { unzipSync, strFromU8 } from 'fflate'

const cargar = createRequire(import.meta.url)

function transpilar(ruta, requerir) {
  const js = ts.transpileModule(fs.readFileSync(ruta, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const modulo = { exports: {} }
  vm.runInNewContext(js, { module: modulo, exports: modulo.exports, Buffer, require: requerir })
  return modulo.exports
}

const formato = { fecha: v => v ?? '—', fechaHora: v => v ?? '—' }
const dominio = transpilar('src/lib/dominio/informe-diseno.ts', cargar)
const generador = transpilar('src/lib/documentos/informe-diseno.ts', nombre =>
  nombre === '@/lib/format' ? formato : nombre === '@/lib/dominio/informe-diseno' ? dominio : cargar(nombre))

async function main() {
  const archivo = await generador.generarInformeDiseno({
    informe: { numero: 22, responsable: 'Equipo de Diseño', resumen: 'Prueba Metal Work', incidencias: 'Falta de coordinación\n- Cambios del cliente', acciones: '', no_conformidades: '', indicadores: '', plan_siguiente: '', conclusiones: '' },
    inicio: '2026-09-28', fin: '2026-10-04', enviado: false,
    tareas: [{ id: 't', orden_id: 'o', integrante_id: 'i', ot: '2922-2026', codigo_interno: 'COM_CM_N2_1_26/43', tipo_unidad: 'CARROCERIA_MONTADA', tipo: 'PLANO_CORTE_DXF', componente: 'Componente de prueba', fecha_inicio: '2026-09-28', fecha_entrega: '2026-09-29', responsable: 'Colaborador de prueba', observacion: '' }],
    entregas: [{ id: 'e', orden_id: 'o', integrante_id: 'i', ot: '2922-2026', codigo_interno: 'COM_CM_N2_1_26/43', tipo_unidad: 'CARROCERIA_MONTADA', tipo_plano: 'Hab/arm envolturas y tapas', n_planos: 8, n_piezas: 8, fecha_entrega: '2026-09-29', estado: 'CULMINADO', entregado_a: ['MTZ', 'PRD'], responsable: 'Colaborador de prueba' }],
  }, null)
  const zip = unzipSync(new Uint8Array(archivo))
  const xml = strFromU8(zip['word/document.xml'])
  const cabecera = Object.keys(zip).filter(k => /^word\/header\d*\.xml$/.test(k)).map(k => strFromU8(zip[k])).join('')
  for (const valor of ['INFORME SEMANAL – ÁREA DE INGENIERÍA', '022', 'Prueba Metal Work', 'COMPONENTE DE PRUEBA', 'COM_CM_N2_1_26/43/2922',
    'CREACIÓN DE PLANO DE CORTE DXF', 'HAB/ARM ENVOLTURAS Y TAPAS', '8 PLANOS ENTREGADOS A MAESTRANZA.', '8 PLANOS ENTREGADOS A PRODUCCIÓN.',
    'Cambios del cliente', '2026-10-03']) {
    if (!xml.includes(valor)) throw new Error(`Falta texto en el Word: ${valor}`)
  }
  for (const valor of ['MW-IF-DI-01', '30/05/2026', 'INFORME']) {
    if (!cabecera.includes(valor)) throw new Error(`Falta en la cabecera del Word: ${valor}`)
  }
  if (!xml.includes('w:orient="landscape"')) throw new Error('El Word no sale en horizontal como el formato.')
  console.log(`Word válido: ${archivo.length} bytes, ${Object.keys(zip).length} partes, en horizontal, con cabecera del formato, tareas, avance de planos y conclusión.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
