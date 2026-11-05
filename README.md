# 🩴 Chancla Kart

Carreras de karts multijugador en el navegador, rollo Mario Kart pero con chanclas, cuñados y patos teledirigidos.
Hasta **4 humanos** (+ bots hasta 6 karts). Sin servidor propio: los navegadores se conectan entre sí por WebRTC.

## Jugar

1. Uno pulsa **Crear sala** → sale un código de 4 letras y un botón para copiar el enlace.
2. Los demás abren el enlace (o meten el código) y pulsan **Unirse**.
3. El anfitrión elige pista, vueltas y bots y pulsa **¡A CORRER!**

| Acción | Teclado | Mando | Móvil |
| --- | --- | --- | --- |
| Acelerar / frenar | ↑ ↓ / W S | A / B, gatillos | automático / 🛑 |
| Girar | ← → / A D | stick, cruceta | ◀ ▶ |
| Derrapar (miniturbo al soltar) | Espacio / Shift | RB | 💨 |
| Usar objeto | E / X | LB / X | 🎁 |
| Claxon | H | Y | 📯 |

Truco: acelera justo en el **1** de la cuenta atrás → turbo de salida. Si lo pisas desde el 3… se te cala.

### Objetos
- 🩴 **Chancla** – se lanza hacia delante y rebota en los muros.
- 🍌 **Plátano** – lo dejas detrás.
- 🥘 **Croqueta Turbo** – turbo.
- 🧔 **Cuñado** – le cae al primero: le frena y le suelta frases de cuñado.
- 🦆 **Pato Teledirigido** – persigue al de delante.
- 🥴 **Resaca** – controles invertidos para todos los demás.

El reparto depende de la posición: el primero sólo recibe objetos defensivos.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest
npm run build    # typecheck + build a dist/
```

### Arquitectura
- `src/game/` – lógica pura y determinista (física, pista, objetos, bots, carrera). Sin DOM: se testea entera.
- `src/net/` – protocolo, sesiones anfitrión/cliente y transporte. El **anfitrión es autoritativo** (simula a 60 Hz
  y manda snapshots a 20 Hz); el cliente **predice su propio kart** y reconcilia re-simulando las entradas no confirmadas.
  `transport.ts` tiene un transporte en memoria con el que los tests simulan partidas en red completas (con lag).
- `src/net/peer.ts` – adaptador PeerJS (WebRTC).
- `src/client/` – render en Canvas 2D, audio sintetizado con WebAudio (sin ficheros), controles.

## Despliegue

El build es estático (`dist/`) con rutas relativas, así que vale para cualquier hosting.

**GitHub Pages**: en *Settings → Pages → Source* elige **GitHub Actions**. Cada push a `main` pasa los tests y publica
(`.github/workflows/deploy.yml`).

**Cloudflare Pages**: conecta el repo, *Build command* `npm run build`, *Output* `dist`.
O con Workers: `npx wrangler login` y `npm run deploy:cf` (usa `wrangler.jsonc`).

### Sobre la red
La señalización usa el servidor público gratuito de PeerJS (`0.peerjs.com`). Sólo se usa para el apretón de manos;
la partida va directa entre navegadores. Si algún día falla, puedes montar el tuyo (`npx peerjs --port 9000`) y
compilar con `VITE_PEER_HOST=tu.host VITE_PEER_PORT=443`, o probarlo en caliente con `?peer=host:puerto`.
Redes muy restrictivas (algunas corporativas o 4G con CGNAT) pueden necesitar TURN; PeerJS trae uno por defecto.
