# CMMS Intelligence

Aplicación web estática para analizar datasets de órdenes de trabajo CMMS. No requiere servidor de aplicación ni proceso de compilación; puede publicarse como carpeta en GitHub Pages.

## Uso

1. Abre `index.html` en un navegador moderno o publícala en GitHub Pages.
2. Selecciona un archivo `.csv`, `.xlsx` o `.xls`.
3. Ajusta los filtros de tipo de mantenimiento y período.
4. Selecciona **Exportar informe PDF** y, en el diálogo de impresión del navegador, elige **Guardar como PDF**.

En CSV se detectan automáticamente delimitadores coma, punto y coma o tabulación; se admiten comillas, BOM UTF-8 y valores con apóstrofo inicial. Para libros Excel se analiza la primera hoja. El lector XLSX se obtiene de jsDelivr al cargar un libro Excel; los CSV funcionan sin conexión externa.

## Esquema CMMS esperado

La columna `Tipo_mantenimiento` es necesaria. Para identificar registros se espera al menos `OT`, `Fecha_inicio` o `Equipo`. Las columnas métricas se detectan de forma independiente:

| Indicador | Columna reconocida |
| --- | --- |
| Órdenes | `OT` |
| Fecha | `Fecha_inicio` o `Fecha_fin` |
| Estrategia | `Tipo_mantenimiento` |
| Modo de falla | `Modo_falla` |
| Horas-hombre | `Horas_mano_obra` |
| Indisponibilidad | `Downtime_h` |
| Costos | `Costo_total_CLP` |
| MTTR y mediana | `Tiempo_reparacion_h` |
| Equipo | `Equipo`, `Tipo_equipo` |

Los nombres pueden venir con espacios, tildes y diferencias de mayúsculas. Los campos ausentes se muestran como no disponibles; no se imputan ni se inventan valores. El MTTR y la mediana se calculan con `Tiempo_reparacion_h` para órdenes correctivas cerradas, cuando el estado se encuentra disponible.

## Publicación en GitHub Pages

Publica la carpeta `webapp` como raíz del sitio, o configura Pages para servir desde la rama y ruta donde esté `webapp`. Los archivos HTML, CSS y JavaScript son estáticos. Los datos cargados se procesan en memoria en el navegador, no se envían a ningún servicio.

El informe utiliza la función de impresión del navegador y sus estilos de impresión para crear el PDF. Para abrir localmente el reporte, el navegador debe permitir el diálogo de impresión.
