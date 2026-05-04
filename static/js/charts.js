const variablesFijas = [
    { id: 'pp', label: 'Precipitación (mm)', isBar: true, fill: true },
    { id: 'temp', label: 'Temperatura (°C)', isBar: false, fill: false },
    { id: 'et', label: 'Evapotranspiración (mm)', isBar: true, fill: true },
    { id: 'dew', label: 'Punto de Rocío (°C)', isBar: false, fill: false },
    { id: 'rad', label: 'Radiación Solar SW (W/m²)', isBar: false, fill: true },
    { id: 'hr', label: 'Humedad Relativa (%)', isBar: false, fill: true },
    { id: 'v_vel', label: 'Velocidad del Viento (m/s)', isBar: false, fill: true },
    { id: 'pres', label: 'Presión Superficial (hPa)', isBar: false, fill: false },
    { id: 'nbaja', label: 'Nubosidad Baja (%)', isBar: false, fill: true },
    { id: 'nmedia', label: 'Nubosidad Media (%)', isBar: false, fill: true },
    { id: 'nalta', label: 'Nubosidad Alta (%)', isBar: false, fill: true }
];

// COLORES PROFESIONALES ÚNICOS PARA CADA MODELO (No se repiten en barras)
const modelColorsExact = {
    'ICON_GLOBAL': '#1f77b4',     // Azul serio
    'GFS_GLOBAL': '#2ca02c',      // Verde clásico
    'GFS_AI': '#98df8a',          // Verde claro (Inteligencia Artificial)
    'GFS_GRA': '#006400',         // Verde oscuro (GraphCast)
    'ARPEGE_GLOBAL': '#9467bd',   // Púrpura
    'ARPEGE_BESMATCH': '#c5b0d5', // Púrpura claro
    'ECMWF_9KM': '#d62728',       // Rojo
    'ECMWF_25KM': '#ff9896',      // Salmón
    'UKMO_GLOBAL': '#ff7f0e',     // Naranja
    'KMA_GLOBAL': '#8c564b',      // Marrón
    'GSM_GLOBAL': '#e377c2',      // Rosa oscuro
    'GEM_GLOBAL': '#17becf',      // Cian oscuro
    'CMA_GRAPES': '#7f7f7f',      // Gris
    'WRF_AMBIAND': '#bcbd22'      // Oliva/Oro viejo
};

const pointLineDash = [ [], [4, 4], [2, 2], [8, 4] ];
let activeCharts = {};

function renderComparativos() {
    const selectedPuntos = [...document.querySelectorAll('.chk-punto:checked')].map(e => e.value);
    const selectedModelos = [...document.querySelectorAll('.chk-modelo:checked')].map(e => e.value);
    const selectedVars = [...document.querySelectorAll('.chk-var:checked')].map(e => e.value);
    const container = document.getElementById('chartsContainer');

    Object.values(activeCharts).forEach(chart => chart.destroy());
    activeCharts = {};
    container.innerHTML = '';

    if (selectedPuntos.length === 0 || selectedModelos.length === 0 || selectedVars.length === 0) {
        container.innerHTML = `<div class="chart-placeholder">Selecciona al menos 1 Punto, 1 Modelo y 1 Variable para visualizar los datos comparativos.</div>`;
        return;
    }

    const fInicio = document.getElementById('fechaInicio').value;
    const fFin = document.getElementById('fechaFin').value;
    const dataPuntosSelect = datosTemporales.filter(d => selectedPuntos.includes(d.punto));

    // CORRECCIÓN: Filtro riguroso del Eje X (Horario vs Diario)
    let labelsTime = [];
    if (vistaActual === 'diario') {
        labelsTime = [...new Set(dataPuntosSelect.map(d => d.fecha_calendario))].filter(f => f >= fInicio && f <= fFin).sort();
    } else {
        // En horario, solo extrae las horas del día seleccionado (diaHorarioSeleccionado)
        labelsTime = [...new Set(dataPuntosSelect.filter(d => d.fecha_calendario === diaHorarioSeleccionado || d.fecha_hidro === diaHorarioSeleccionado).map(d => d.hora_str))].sort();
    }

    selectedVars.forEach(varId => {
        const defVar = variablesFijas.find(v => v.id === varId);
        const cardId = `card_chart_${varId}`;
        const canvasId = `canvas_${varId}`;
        const div = document.createElement('div');
        div.className = 'chart-card';
        div.id = cardId;

        // CORRECCIÓN: Título dinámico que muestra el día exacto en vista horaria
        let subtitle = vistaActual === 'diario' ? 'VISTA DIARIA' : `VISTA HORARIA (${diaHorarioSeleccionado})`;

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">
                <h3 style="margin:0; color:#333; font-size: 14px; text-transform: uppercase; font-family: 'Segoe UI', sans-serif;">
                    <i class="fa-solid fa-chart-simple" style="color:#2980b9;"></i> ${defVar.label}
                </h3>
                <span style="font-size:10px; background:#f8f9fa; padding:4px 10px; border-radius:4px; color:#555; border: 1px solid #ddd; font-weight: bold;">
                    ${subtitle}
                </span>
            </div>
            <div style="position: relative; height: calc(100% - 35px); width: 100%;">
                <canvas id="${canvasId}"></canvas>
            </div>
        `;
        container.appendChild(div);

        let datasets = [];
        let pointIndex = 0;

        selectedPuntos.forEach(pto => {
            const dashStyle = pointLineDash[pointIndex % pointLineDash.length];
            let ensamblesPorPunto = Array(labelsTime.length).fill(0).map(() => ({ sum: 0, count: 0 }));

            selectedModelos.forEach(mod => {
                let dataValues = [];
                labelsTime.forEach((timeLabel, idx) => {
                    const registros = dataPuntosSelect.filter(d => {
                        // CORRECCIÓN: El filtrado horario ahora respeta el día seleccionado
                        let matchTime = false;
                        if(vistaActual === 'diario') {
                            matchTime = ((varId === 'pp' || varId === 'et') ? d.fecha_hidro === timeLabel : d.fecha_calendario === timeLabel);
                        } else {
                            let f_usar = (varId === 'pp' || varId === 'et') ? d.fecha_hidro : d.fecha_calendario;
                            matchTime = (d.hora_str === timeLabel && f_usar === diaHorarioSeleccionado);
                        }
                        return d.punto === pto && d.modelo === mod && matchTime;
                    });

                    let valValid = registros.map(r => r[varId]).filter(v => v !== null && v !== undefined && !isNaN(v));
                    let finalVal = null;
                    if (valValid.length > 0) {
                        if (varId === 'pp' || varId === 'et') finalVal = valValid.reduce((a,b)=>a+b, 0);
                        else if (varId === 'rad') {
                            let valRad = valValid.filter(v => v > 0);
                            finalVal = valRad.length > 0 ? valRad.reduce((a,b)=>a+b, 0) / valRad.length : 0;
                        } else finalVal = valValid.reduce((a,b)=>a+b, 0) / valValid.length;
                    }

                    dataValues.push(finalVal);
                    if (finalVal !== null) { ensamblesPorPunto[idx].sum += finalVal; ensamblesPorPunto[idx].count++; }
                });

                let colorModelo = modelColorsExact[mod] || '#888888';

                if(dataValues.some(v => v !== null)) {
                    datasets.push({
                        label: `${mod}`,
                        data: dataValues,
                        borderColor: colorModelo,
                        backgroundColor: defVar.isBar ? colorModelo + '90' : colorModelo + '15', // Opacidad elegante
                        borderWidth: defVar.isBar ? 1 : 1.5,
                        borderDash: dashStyle,
                        fill: !defVar.isBar && defVar.fill,
                        tension: 0.1, // CORRECCIÓN: Líneas casi rectas y rigurosas, aspecto científico
                        pointRadius: vistaActual === 'diario' ? 2 : 1.5,
                        pointHoverRadius: 5,
                        type: defVar.isBar ? 'bar' : 'line'
                    });
                }
            });

            // LÍNEA ESTADÍSTICA DE CONSENSO
            let promedioValores = ensamblesPorPunto.map(e => e.count > 0 ? e.sum / e.count : null);
            if(promedioValores.some(v => v !== null)) {
                datasets.push({
                    label: `★ CONSENSO (${pto})`,
                    data: promedioValores,
                    borderColor: '#111111',
                    backgroundColor: 'rgba(17, 17, 17, 0.05)',
                    borderWidth: 2.5,
                    borderDash: [4, 4],
                    fill: false,
                    tension: 0.1,
                    pointRadius: vistaActual === 'diario' ? 3 : 0,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#111',
                    type: 'line',
                    order: -1 // Se dibuja por encima de todas las demás
                });
            }
            pointIndex++;
        });

        const ctx = document.getElementById(canvasId).getContext('2d');
        activeCharts[varId] = new Chart(ctx, {
            type: defVar.isBar ? 'bar' : 'line',
            data: { labels: labelsTime, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    // CORRECCIÓN: Leyenda a la derecha con estilo sobrio
                    legend: { position: 'right', labels: { boxWidth: 12, usePointStyle: true, font: { size: 10, family: 'Segoe UI' } } },
                    tooltip: { backgroundColor: 'rgba(34, 45, 50, 0.95)', titleFont: { size: 13 }, bodyFont: { size: 11 }, padding: 10 }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                    y: { beginAtZero: (varId === 'pp' || varId === 'et' || varId === 'rad' || varId === 'v_vel'), grid: { color: '#f0f0f0' }, ticks: { font: { size: 10 } } }
                }
            }
        });
    });
}