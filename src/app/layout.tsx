import { Arimo, Jost } from 'next/font/google'
import type { Metadata, Viewport } from 'next'

import { GuionEnLinea } from '@/components/estructura/guion-en-linea'
import { RegistrarTrabajador } from '@/components/estructura/registrar-trabajador'

import './globals.css'

// La identidad de la marca pide Futura Now Headline para titulares y
// Liberation Sans para el texto. Futura Now es de pago: Jost es el geométrico
// libre que más se le parece. Arimo es Liberation Sans con otro nombre.
const jost = Jost({ subsets: ['latin'], variable: '--fuente-titulos', display: 'swap' })
const arimo = Arimo({ subsets: ['latin'], variable: '--fuente-texto', display: 'swap' })

export const metadata: Metadata = {
  applicationName: 'Metal Work',
  title: {
    default: 'Metal-Work · Gestión de órdenes de trabajo',
    template: '%s · Metal-Work',
  },
  description:
    'Cotizaciones, órdenes de trabajo y el avance del taller, con foto, para fabricación de carrocerías.',
  // Instalada en el iPhone, se abre como aplicación con su nombre y su ícono.
  // El manifiesto (app/manifest.ts) hace lo mismo en Android.
  appleWebApp: { capable: true, title: 'Metal Work', statusBarStyle: 'default' },
  icons: { apple: '/iconos/apple-touch-icon.png' },
  // Sin esto el iPhone convierte en llamada cualquier número largo: un RUC, el
  // número de una orden.
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deja pintar hasta el borde en los teléfonos con muesca; los márgenes los
  // ponen la barra de arriba y la de abajo con `safe-area-inset`.
  viewportFit: 'cover',
  // El color de la barra de estado es el de la barra de arriba, para que en la
  // aplicación instalada no se vea el corte entre el teléfono y el sistema.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#151b23' },
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
      <body className="min-h-full">
        {children}
        <RegistrarTrabajador />
      </body>
    </html>
  )
}
