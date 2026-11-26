import { SearchX } from 'lucide-react'

import { EnlaceBoton } from '@/components/ui/enlace-boton'

/**
 * Un reporte de seguridad que quien mira ya no ve. El caso común no es un error:
 * el aviso «Acción correctiva a tu cargo» sigue en la campana después de que
 * SSOMA reasignó o anuló esa acción, y sin otra relación con el reporte la base
 * ya no se lo muestra. Se dice eso y se lleva a la pantalla de SSOMA, donde
 * están las que sí siguen a su cargo.
 */
export default function ReporteSsomaNoEncontrado() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-neutro-suave text-texto-suave">
        <SearchX aria-hidden className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-texto">Este reporte ya no está a tu vista</h1>
      <p className="mt-2 text-sm text-texto-suave">
        Si llegaste desde un aviso de una acción correctiva, SSOMA pudo pasarla a otra persona o anularla: ya no está a tu cargo.
        Las que sí lo están, y tus reportes, siguen en Seguridad.
      </p>
      <EnlaceBoton href="/ssoma" className="mt-6">
        Ver tus reportes y acciones
      </EnlaceBoton>
    </div>
  )
}
