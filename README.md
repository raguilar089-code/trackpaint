# TrackPaint

Diseña circuitos de carreras, urbanos o permanentes, sobre un mapa real.

## Qué hace

- Mapa real (OpenStreetMap) o vista satélite, en 2D o inclinado en 3D con edificios.
- Buscador de ciudades, calles y lugares.
- Trazado con curvas suaves a partir de puntos, u opción de **seguir las calles**.
- Ancho de pista real en metros, sentido de giro y línea de salida/meta.
- **Pintar** la pista a mano alzada arrastrando sobre el mapa, o colocarla punto a punto.
- Edición: arrastrar puntos, insertar haciendo clic sobre la pista, borrar con doble clic o clic derecho, deshacer y rehacer.
- Curvas redondeadas también al seguir las calles, sin picos en los cruces.
- Mover el mapa con W A S D (Mayús para ir más rápido).
- Longitud del circuito.
- **Elementos de pista**: pianos (rojo, azul o amarillo; automáticos en todas las curvas o a mano), muros (también automáticos a ambos lados), vallas, barreras de neumáticos, escapatorias de grava o asfalto, césped, pit lane, boxes y gradas. Se pueden seleccionar, mover, girar, cambiar de lado y borrar. Los boxes y gradas se ven en 3D.
- **Carrera**: 3 sectores, speed trap, zonas de Straight Mode y punto de detección del Overtake Mode (los sustitutos del DRS desde 2026), a mano o automáticos.
- **Seguridad**: puestos de comisarios numerados y grúas, a mano o automáticos.
- **▶ Vuelta**: la cámara sigue a un coche durante una vuelta, con un rótulo al estilo de las retransmisiones: tiempo, sectores, velocidad, marcha, revoluciones, acelerador y freno, minimapa, curva actual, Straight Mode y speed trap. La velocidad se calcula según lo cerradas que sean las curvas.
- **Exportar póster** en PNG (2000 × 2828 px), oscuro o claro: trazado con curvas numeradas, salida/meta y sentido de giro, bandera y nombre del país, ciudad, longitud, número de curvas, recta más larga y sentido de giro.
- Guardar circuitos en el navegador y exportarlos o importarlos como archivo `.trackpaint.json`.

## Texturas y modelos

`public/assets/unity/` contiene texturas y modelos FBX del proyecto Circuit Tycoon
(Unity), del mismo autor. `public/assets/patterns/` tiene versiones reducidas de
la grava, el asfalto y el césped que se usan como relleno en el mapa.

## Desarrollo

```bash
npm install
npm run dev     # servidor local
npm test        # pruebas
npm run build   # versión de producción en dist/
```

La web se publica en GitHub Pages con cada cambio en `main`
(`.github/workflows/deploy.yml`).

## Servicios externos

Todos son gratuitos y no necesitan clave:

- Mapa: [OpenFreeMap](https://openfreemap.org) con datos de © OpenStreetMap.
- Satélite: Esri World Imagery.
- Búsqueda: Nominatim (OpenStreetMap).
- Seguir calles: Valhalla de FOSSGIS (valhalla1.openstreetmap.de), por calles de coches pero ignorando sentidos únicos, giros prohibidos y cortes, para que el trazado pueda ir en cualquier sentido.

Nominatim y Valhalla son servicios de uso ligero; la app solo los llama cuando el
usuario busca o termina de mover un punto.
