#!/usr/bin/env python3
"""La música de la plantilla: una base suave, siempre la misma.

    python3 scripts/musica.py            # escribe public/musica/base.m4a

Se sintetiza aquí —acordes largos y una nota que cae cada tiempo—, así que no
depende de ninguna pista con licencia de terceros y sale idéntica cada vez (la
semilla es fija). Dura 150 s: alcanza para el video más largo (2 min) con su
cola. `hacer.mjs` la baja a -25 dB bajo la voz y le pone entrada y salida.

Si un día se cambia por una pista comprada, basta dejarla en el mismo archivo.
"""
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

FRECUENCIA = 44100
DURACION = 150.0
TEMPO = 72  # pulsos por minuto: tranquilo, no marca el paso de la voz
RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / 'public' / 'musica' / 'base.m4a'

# Re mayor: Re · Si menor · Sol · La. Cuatro compases por acorde.
ACORDES = [
    [146.83, 220.00, 293.66, 369.99],  # Re
    [123.47, 185.00, 293.66, 369.99],  # Si menor
    [98.00, 196.00, 293.66, 392.00],   # Sol
    [110.00, 220.00, 277.18, 329.63],  # La
]


def envolvente(n: int, ataque: float, caida: float) -> np.ndarray:
    e = np.ones(n)
    a = int(ataque * FRECUENCIA)
    c = int(caida * FRECUENCIA)
    e[:a] = np.linspace(0, 1, a) ** 2
    e[-c:] = np.linspace(1, 0, c) ** 2
    return e


def main() -> int:
    rng = np.random.default_rng(2026)
    total = int(DURACION * FRECUENCIA)
    izq = np.zeros(total)
    der = np.zeros(total)
    pulso = 60.0 / TEMPO
    largo_acorde = pulso * 8

    # El colchón: cada acorde entra y sale despacio y se pisa con el siguiente.
    i = 0
    inicio = 0.0
    while inicio < DURACION:
        notas = ACORDES[i % len(ACORDES)]
        n = int(min(largo_acorde + 1.5, DURACION - inicio) * FRECUENCIA)
        if n <= FRECUENCIA:
            break
        t = np.arange(n) / FRECUENCIA
        e = envolvente(n, 1.6, min(2.4, n / FRECUENCIA / 2))
        for k, f in enumerate(notas):
            desafine = 1 + (rng.random() - 0.5) * 0.004
            onda = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2 * desafine * t) + 0.12 * np.sin(2 * np.pi * f * 3 * t)
            vibrato = 1 + 0.06 * np.sin(2 * np.pi * 0.21 * t + k)
            capa = onda * e * vibrato * (0.16 if k else 0.22)
            a = int(inicio * FRECUENCIA)
            paneo = 0.5 + (k - 1.5) * 0.14
            izq[a : a + n] += capa * (1 - paneo)
            der[a : a + n] += capa * paneo
        inicio += largo_acorde
        i += 1

    # La nota que cae cada tiempo: una campana corta sobre el acorde del momento.
    t_nota = np.arange(int(1.6 * FRECUENCIA)) / FRECUENCIA
    paso = 0
    momento = pulso * 8  # entra después del primer acorde, no encima del gancho
    while momento < DURACION - 2:
        notas = ACORDES[int(momento // largo_acorde) % len(ACORDES)]
        f = notas[[1, 2, 3, 2, 1, 3, 2, 3][paso % 8]] * 2
        campana = (np.sin(2 * np.pi * f * t_nota) + 0.25 * np.sin(2 * np.pi * f * 2 * t_nota)) * np.exp(-t_nota * 3.2) * 0.11
        a = int(momento * FRECUENCIA)
        n = min(len(campana), total - a)
        paneo = 0.35 + 0.3 * ((paso % 4) / 3)
        izq[a : a + n] += campana[:n] * (1 - paneo)
        der[a : a + n] += campana[:n] * paneo
        momento += pulso
        paso += 1

    mezcla = np.stack([izq, der], axis=1)
    mezcla /= np.max(np.abs(mezcla)) * 1.12
    crudo = SALIDA.with_suffix('.wav')
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(crudo), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(FRECUENCIA)
        w.writeframes((mezcla * 32767).astype('<i2').tobytes())
    # Un filtro que le quita el brillo: la voz va encima y necesita ese espacio.
    r = subprocess.run(
        ['ffmpeg', '-y', '-v', 'error', '-i', str(crudo), '-af', 'lowpass=f=3200,aecho=0.6:0.5:90:0.25', '-c:a', 'aac', '-b:a', '128k', str(SALIDA)],
    )
    crudo.unlink()
    if r.returncode != 0:
        return r.returncode
    print(f'música: {SALIDA.relative_to(RAIZ)} ({DURACION:.0f} s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
