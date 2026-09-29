import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { unzipSync, strFromU8 } from 'fflate'

const cargar = createRequire(import.meta.url)

const fuente = fs.readFileSync('src/lib/documentos/informe-diseno.ts', 'utf8')
const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const modulo = { exports: {} }
const formato = { fecha: v => v ?? '—', fechaHora: v => v ?? '—' }
vm.runInNewContext(js, {
  module: modulo, exports: modulo.exports, Buffer,
  require: nombre => nombre === '@/lib/format' ? formato : cargar(nombre),
})

async function main() {
  const archivo = await modulo.exports.generarInformeDiseno({
    informe: { numero: 21, responsable: 'Equipo de Diseño', resumen: 'Prueba Metal Work', incidencias: '', acciones: '', no_conformidades: '', indicadores: '', plan_siguiente: '', conclusiones: '' },
    inicio: '2026-09-28', fin: '2026-10-04',
    tareas: [{ id: 't', ot: '2919-2026', tipo: 'MODELADO', componente: 'Componente de prueba', fecha_inicio: '2026-09-28', fecha_entrega: '2026-09-29', responsable: 'Colaborador de prueba', observacion: '' }],
    planos: [{ id: 'p', ot: '2919-2026', numero: 1, nombre: 'Plano de prueba', area: 'Producción', responsable: 'Colaborador de prueba', entregado_en: '2026-09-29T12:00:00Z', estado: 'APROBADO' }],
  })
  const zip = unzipSync(new Uint8Array(archivo))
  const xml = strFromU8(zip['word/document.xml'])
  for (const valor of ['INFORME SEMANAL N.º 21', 'Prueba Metal Work', 'Componente de prueba', 'Plano de prueba']) {
    if (!xml.includes(valor)) throw new Error(`Falta texto en el Word: ${valor}`)
  }
  console.log(`Word válido: ${archivo.length} bytes, ${Object.keys(zip).length} partes, tareas y planos presentes.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
