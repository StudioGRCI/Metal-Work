/*
 * El trabajador de la aplicación instalada. Hace una sola cosa: si el taller se
 * queda sin señal y alguien abre una pantalla, en vez del dinosaurio del
 * navegador sale una página propia que dice qué pasa y qué hacer.
 *
 * NO guarda ninguna pantalla del sistema: son datos reales de la empresa,
 * cambian a cada rato y dependen de quién entró. Lo único guardado es la
 * página «sin conexión», que es estática y no tiene datos. Todo lo demás va
 * siempre a la red, como si este archivo no existiera.
 *
 * Al cambiar este archivo, subir VERSION: el navegador instala el nuevo y
 * borra la copia vieja de la página.
 */
const VERSION = 'metal-work-1'
const SIN_CONEXION = '/sin-conexion.html'

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([SIN_CONEXION, '/iconos/icono-192.png']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  // Solo las pantallas que se abren. Datos, fotos, acciones: ni se tocan.
  if (evento.request.mode !== 'navigate') return

  evento.respondWith(
    fetch(evento.request).catch(() =>
      caches.match(SIN_CONEXION).then((pagina) => pagina ?? Response.error()),
    ),
  )
})
