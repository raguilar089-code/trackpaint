# TrackPaint

Diseña circuitos de carreras, urbanos o permanentes, sobre un mapa real.

## Qué hace (paso 1)

- Mapa real (OpenStreetMap) o vista satélite, en 2D o inclinado en 3D con edificios.
- Buscador de ciudades, calles y lugares.
- Trazado con curvas suaves a partir de puntos, u opción de **seguir las calles**.
- Ancho de pista real en metros, sentido de giro y línea de salida/meta.
- **Pintar** la pista a mano alzada arrastrando sobre el mapa, o colocarla punto a punto.
- Edición: arrastrar puntos, insertar haciendo clic sobre la pista, borrar con doble clic o clic derecho, deshacer y rehacer.
- Longitud del circuito.
- Guardar circuitos en el navegador y exportarlos o importarlos como archivo `.trackpaint.json`.

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
- Seguir calles: servidor de demostración de OSRM.

Nominatim y OSRM son servicios de uso ligero; la app solo los llama cuando el
usuario busca o termina de mover un punto.
