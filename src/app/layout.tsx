import { Arimo, Jost } from 'next/font/google'
import type { Metadata, Viewport } from 'next'

import { GuionEnLinea } from '@/components/estructura/guion-en-linea'

import './globals.css'

// La identidad de la marca pide Futura Now Headline para titulares y
// Liberation Sans para el texto. Futura Now es de pago: Jost es el geométrico
// libre que más se le parece. Arimo es Liberation Sans con otro nombre.
const jost = Jost({ subsets: ['latin'], variable: '--fuente-titulos', display: 'swap' })
const arimo = Arimo({ subsets: ['latin'], variable: '--fuente-texto', display: 'swap' })

export const metadata: Metadata = {
  title: {
    default: 'Metal-Work · Gestión de órdenes de trabajo',
    template: '%s · Metal-Work',
  },
  description:
    'Control de órdenes de trabajo, trazabilidad documental, almacén y costos para fabricación de carrocerías.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
}

/**
 * Se aplica el tema elegido antes de que el navegador pinte la primera pantalla.
 * Si esto corriera después, se vería el destello de la pantalla clara antes de
 * pasar a oscura, que es justo lo que molesta de noche en el taller.
 */
const APLICAR_TEMA = `try{var t=localStorage.getItem('metalwork:tema');if(t==='claro'||t==='oscuro'){document.documentElement.setAttribute('data-tema',t)}}catch(e){}`

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // El guion de arriba escribe `data-tema` en esta misma etiqueta antes de que
    // React hidrate, así que el atributo no coincide con lo que vino del
    // servidor. Es a propósito: se avisa para que React no lo reporte.
    <html lang="es-PE" className={`h-full ${jost.variable} ${arimo.variable}`} suppressHydrationWarning>
      <head>
        <GuionEnLinea html={APLICAR_TEMA} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
