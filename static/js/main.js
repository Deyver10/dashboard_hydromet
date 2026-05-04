// ========================================================
// VARIABLES GLOBALES
// ========================================================
let puntosGuardados = [];
let datosTemporales = [];
let estadoModelos = {};
let vistaActual = 'diario';
let diaHorarioSeleccionado = null;
let legendCtrl = null;

const dHoy = new Date();
const fechaHoyString = dHoy.getFullYear() + "-" + String(dHoy.getMonth() + 1).padStart(2, '0') + "-" + String(dHoy.getDate()).padStart(2, '0');

// ========================================================
// INICIALIZACIÓN
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initCheckboxesAnalitica();
    cargarPuntosDeStorage(); // Ahora trae los datos del servidor Python
});

// ========================================================
// 1. GESTIÓN DE PUNTOS CON EL BACKEND (API REST)
// ========================================================
async function cargarPuntosDeStorage() {
    try {
        const res = await fetch('/api/puntos');
        puntosGuardados = await res.json();
        actualizarUIListaPuntos();
    } catch (error) {
        console.error("Error cargando puntos del usuario", error);
    }
}

function actualizarUIListaPuntos() {
    const select = document.getElementById('puntoSelect');

    select.innerHTML = `
        <option value="" disabled selected style="color: #999;">Seleccionar punto...</option>
        <option value="TEMP_NUEVO_PUNTO" style="color: #27ae60; font-weight: bold;">&#x2795; Agregar Nuevo Punto</option>
    `;

    puntosGuardados.forEach(p => {
        let opt = document.createElement('option');
        opt.value = p.nombre;
        opt.textContent = p.nombre;
        select.appendChild(opt);
    });
}

async function handlePuntoSelection() {
    const val = document.getElementById('puntoSelect').value;
    const btnEliminar = document.getElementById('btnEliminarPunto');

    // MODO: AGREGAR NUEVO PUNTO
    if (val === "TEMP_NUEVO_PUNTO" || val === "") {
        if(btnEliminar) btnEliminar.style.display = 'none';

        document.getElementById('formNuevoPunto').style.display = 'block';
        document.getElementById('divControlesExtra').style.display = 'none';

        if(document.getElementById('bottomSection')) document.getElementById('bottomSection').style.display = 'none';
        if(document.getElementById('analiticaSection')) document.getElementById('analiticaSection').style.display = 'none';

        // Limpiamos los inputs
        document.getElementById('tempNombre').value = '';
        document.getElementById('tempLat').value = '';
        document.getElementById('tempLon').value = '';
        return;
    }

    // MODO: PUNTO SELECCIONADO
    if(btnEliminar) btnEliminar.style.display = 'block';
    document.getElementById('formNuevoPunto').style.display = 'none';

    const pto = puntosGuardados.find(p => p.nombre === val);

    if (pto) {
        focusMapa(pto.lat, pto.lon, pto.nombre);

        const dataExistente = datosTemporales.some(d => d.punto === val);
        if (!dataExistente) {
            await descargarDatosOpenMeteo(pto.lat, pto.lon, pto.nombre);
        } else {
            prepararVistaTabla();
        }
    }
}

async function generarNuevoPunto() {
    let nombre = document.getElementById('tempNombre').value.trim();
    const lat = document.getElementById('tempLat').value;
    const lon = document.getElementById('tempLon').value;

    if(!nombre || !lat || !lon) {
        alert("Completa el nombre y haz clic en el mapa para capturar las coordenadas.");
        return;
    }

    const nuevoPunto = { nombre, lat: parseFloat(lat), lon: parseFloat(lon) };

    const overlay = document.getElementById('loadingOverlay');
    overlay.innerHTML = `
        <div class="spinner"></div>
        <p style="margin: 10px 0 5px 0; font-weight: bold; font-size: 1.1rem;">Descargando de la base de datos.....</p>
        <p style="font-size: 12px; color: #ccc; margin: 0;">Priorizando precipitación, temperatura y viento.</p>
    `;
    overlay.style.display = 'flex';

    try {
        await fetch('/api/puntos/nuevo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nuevoPunto)
        });

        const indexExistente = puntosGuardados.findIndex(p => p.nombre.toLowerCase() === nombre.toLowerCase());
        if(indexExistente !== -1) { puntosGuardados.splice(indexExistente, 1); }

        puntosGuardados.push(nuevoPunto);
        actualizarUIListaPuntos();
        document.getElementById('puntoSelect').value = nombre;

        await descargarDatosOpenMeteo(nuevoPunto.lat, nuevoPunto.lon, nombre);

        document.getElementById('formNuevoPunto').style.display = 'none';
        handlePuntoSelection();

    } catch (error) {
        console.error("Error guardando punto:", error);
        alert("Hubo un problema guardando el punto en la base de datos.");
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

async function eliminarPuntoSeleccionado() {
    const val = document.getElementById('puntoSelect').value;

    if (!val || val === "TEMP_NUEVO_PUNTO") return;

    if (!confirm(`¿Estás seguro de que deseas eliminar la estación "${val}" permanentemente?`)) return;

    try {
        const res = await fetch('/api/puntos/eliminar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: val })
        });

        if (res.ok) {
            puntosGuardados = puntosGuardados.filter(p => p.nombre !== val);
            datosTemporales = datosTemporales.filter(d => d.punto !== val);

            actualizarUIListaPuntos();
            document.getElementById('puntoSelect').value = "";
            handlePuntoSelection();

            if(map) map.setView([-9.19, -75.01], 5);
            if(tempMarker) map.removeLayer(tempMarker);
        } else {
            alert("Hubo un problema al eliminar la estación del servidor.");
        }
    } catch (error) {
        console.error("Error al eliminar:", error);
        alert("Error de conexión al intentar eliminar el punto.");
    }
}

// ========================================================
// 2. MAPA Y UX
// ========================================================
function focusMapa(lat, lon, nombre) {
    map.setView([lat, lon], 9);

    let popupHTML = `<div style="text-align:center;">
                        <b style="color:#1a5276; font-size:14px;">${nombre}</b><br>
                        <span style="font-size:11px; color:#666;">Lat: ${parseFloat(lat).toFixed(4)} | Lon: ${parseFloat(lon).toFixed(4)}</span>
                     </div>`;

    if (tempMarker) map.removeLayer(tempMarker);
    if (typeof markerClic !== 'undefined' && markerClic) map.removeLayer(markerClic);

    tempMarker = L.marker([lat, lon]).addTo(map).bindPopup(popupHTML).openPopup();
    setTimeout(() => { map.invalidateSize(); }, 400);
}

// ========================================================
// 3. DESCARGA DE DATOS (OPEN METEO + WRF)
// ========================================================
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function descargarDatosOpenMeteo(lat, lon, nombrePunto) {
    document.getElementById('loadingOverlay').style.display = 'flex';

    // ¡INCLUYE wind_speed_80m COMO SOLICITASTE!
    const varMeteo = "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_speed_80m,surface_pressure,cloud_cover_low,cloud_cover_mid,cloud_cover_high,shortwave_radiation,dew_point_2m,et0_fao_evapotranspiration";

    const promesas = configModelos.map(async (m, index) => {
        await esperar(index * 300);

        // Se agregó '&wind_speed_unit=kmh' para asegurar la unidad de viento
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${varMeteo}&models=${m.api_name}&forecast_days=${m.days}&past_days=90&timezone=America%2FLima&wind_speed_unit=kmh`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.hourly && data.hourly.precipitation) {
                const h = data.hourly;
                for(let i=0; i < h.time.length; i++) {
                    if(h.precipitation[i] === null) continue;
                    let ts = h.time[i];
                    let fechaCalendario = ts.substring(0,10);
                    let horaStr = ts.substring(11,16);
                    let fechaHidro = Utils.calcularDiaHidrologico(ts);

                    datosTemporales.push({
                        punto: nombrePunto, modelo: m.label, grupo: m.group,
                        fecha_calendario: fechaCalendario, fecha_hidro: fechaHidro, hora_str: horaStr,
                        pp: h.precipitation[i], temp: h.temperature_2m[i], hr: h.relative_humidity_2m[i],
                        v_vel: h.wind_speed_10m[i], pres: h.surface_pressure[i], nbaja: h.cloud_cover_low[i],
                        nmedia: h.cloud_cover_mid[i], nalta: h.cloud_cover_high[i], rad: h.shortwave_radiation[i],
                        dew: h.dew_point_2m[i], et: h.et0_fao_evapotranspiration[i]
                    });
                }
            }
        } catch (err) { console.error("Fallo API:", m.label, err); }
    });

    await Promise.all(promesas);

    // LLAMADA AL WRF LOCAL
    try {
        const resWrf = await fetch(`/api/wrf?lat=${lat}&lon=${lon}`);
        const wrfData = await resWrf.json();
        if (wrfData && wrfData.horario) {
            for (const [f_hora, val_pp] of Object.entries(wrfData.horario)) {
                let fh_parts = f_hora.split(" ");
                let hora = parseInt(fh_parts[1].split(":")[0]);
                let dObj = new Date(fh_parts[0] + 'T00:00:00');
                if (hora < 7) { dObj.setDate(dObj.getDate() - 1); }
                let fh_hidro = dObj.getFullYear() + "-" + String(dObj.getMonth()+1).padStart(2,'0') + "-" + String(dObj.getDate()).padStart(2,'0');

                datosTemporales.push({
                    punto: nombrePunto, modelo: "WRF_AMBIAND", grupo: "WRF",
                    fecha_calendario: fh_parts[0], fecha_hidro: fh_hidro, hora_str: fh_parts[1],
                    pp: val_pp, temp: null, hr: null, v_vel: null, pres: null, nbaja: null, nmedia: null, nalta: null, rad: null, dew: null, et: null
                });
            }
        }
    } catch (err) { console.error("Fallo WRF local:", err); }

    document.getElementById('loadingOverlay').style.display = 'none';
    prepararVistaTabla();
}

function prepararVistaTabla() {
    document.getElementById('divControlesExtra').style.display = 'flex'; // Usamos flex
    document.getElementById('bottomSection').style.display = 'block';
    document.getElementById('analiticaSection').style.display = 'flex';

    const ptoVal = document.getElementById('puntoSelect').value;
    const fechas = [...new Set(datosTemporales.filter(d => d.punto === ptoVal).map(d => d.fecha_calendario))].sort();

    if(fechas.length > 0) {
        document.getElementById('fechaInicio').value = fechaHoyString;
        document.getElementById('fechaFin').value = fechas[fechas.length - 1];
    }
    volverDiario();
}

// ========================================================
// 4. RENDERIZADO Y TABLAS
// ========================================================
function getBadgeClass(grupo) {
    if(!grupo) return 'badge-other';
    grupo = grupo.toUpperCase();
    if(grupo.includes('GFS')) return 'badge-gfs';
    if(grupo.includes('ECMWF')) return 'badge-ecmwf';
    if(grupo.includes('ICON')) return 'badge-icon';
    if(grupo.includes('UKMO')) return 'badge-ukmo';
    if(grupo.includes('ENS')) return 'badge-ens';
    if(grupo.includes('WRF')) return 'badge-wrf';
    return 'badge-other';
}

function getColor(variable, value, vista) {
    if (value === null || value === undefined) return { bg: 'transparent', text: '#adb5bd', cssClass: 'cell-null' };

    if (variable === 'pp') {
        let v = vista === 'horario' ? value * 4 : value;
        if (v < 0.2) return { bg: '#ffffff', text: '#555', cssClass: '' };
        if (v <= 1.0) return { bg: '#c6dbef', text: '#000', cssClass: '' };
        if (v <= 5.0) return { bg: '#6baed6', text: '#000', cssClass: '' };
        if (v <= 10.0) return { bg: '#3182bd', text: '#fff', cssClass: '' };
        if (v <= 20.0) return { bg: '#08519c', text: '#fff', cssClass: '' };
        return { bg: '#08306b', text: '#fff', cssClass: '' };
    }
    if (variable === 'temp' || variable === 'dew') {
        if (value < 0) return { bg: '#313695', text: '#fff', cssClass: '' };
        if (value <= 10) return { bg: '#74add1', text: '#000', cssClass: '' };
        if (value <= 20) return { bg: '#e0f3f8', text: '#000', cssClass: '' };
        if (value <= 30) return { bg: '#fdae61', text: '#000', cssClass: '' };
        return { bg: '#d73027', text: '#fff', cssClass: '' };
    }
    if (['hr', 'nbaja', 'nmedia', 'nalta'].includes(variable)) {
        if (value < 20) return { bg: '#ffffe5', text: '#000', cssClass: '' };
        if (value <= 40) return { bg: '#d9f0a3', text: '#000', cssClass: '' };
        if (value <= 60) return { bg: '#78c679', text: '#000', cssClass: '' };
        if (value <= 80) return { bg: '#238443', text: '#fff', cssClass: '' };
        return { bg: '#004529', text: '#fff', cssClass: '' };
    }
    return { bg: '#f8f9fa', text: '#333', cssClass: '' };
}

function actualizarLeyenda() {
    if (legendCtrl) map.removeControl(legendCtrl);
    const v = document.getElementById('varSelect').value;
    if(datosTemporales.length === 0) return;

    legendCtrl = L.control({position: 'bottomright'});
    legendCtrl.onAdd = function () {
        let div = L.DomUtil.create('div', 'info legend');
        let html = '';
        if (v === 'pp') {
            html += `<h4>Lluvia (mm)<br><span style="font-size:9px">(${vistaActual})</span></h4>`;
            if(vistaActual === 'diario') html += '<i style="background: #f7fbff; border: 1px solid #ddd;"></i> &lt; 0.2<br><i style="background: #c6dbef;"></i> 0.2 - 1.0<br><i style="background: #6baed6;"></i> 1.0 - 5.0<br><i style="background: #3182bd;"></i> 5.0 - 10.0<br><i style="background: #08519c;"></i> 10.0 - 20.0<br><i style="background: #08306b;"></i> &gt; 20.0';
            else html += '<i style="background: #f7fbff; border: 1px solid #ddd;"></i> &lt; 0.1<br><i style="background: #c6dbef;"></i> 0.1 - 0.5<br><i style="background: #6baed6;"></i> 0.5 - 2.0<br><i style="background: #3182bd;"></i> 2.0 - 5.0<br><i style="background: #08519c;"></i> &gt; 5.0';
        } else if (v === 'temp' || v === 'dew') {
            html += `<h4>Temp (°C)</h4><i style="background: #313695;"></i> &lt; 0<br><i style="background: #74add1;"></i> 0 - 10<br><i style="background: #e0f3f8;"></i> 10 - 20<br><i style="background: #fdae61;"></i> 20 - 30<br><i style="background: #d73027;"></i> &gt; 30`;
        } else if (['hr', 'nbaja', 'nmedia', 'nalta'].includes(v)) {
            html += `<h4>Porcentaje (%)</h4><i style="background: #ffffe5;"></i> &lt; 20<br><i style="background: #d9f0a3;"></i> 20 - 40<br><i style="background: #78c679;"></i> 40 - 60<br><i style="background: #238443;"></i> 60 - 80<br><i style="background: #004529;"></i> &gt; 80`;
        } else {
            html += `<h4>Variable</h4><i style="background: #eeeeee;"></i> Bajo<br><i style="background: #999999;"></i> Medio<br><i style="background: #333333;"></i> Alto`;
        }
        div.innerHTML = html;
        return div;
    };
    legendCtrl.addTo(map);
}

function renderTable() {
    const punto = document.getElementById('puntoSelect').value;
    const varSel = document.getElementById('varSelect').value;
    const fInicio = document.getElementById('fechaInicio').value;
    const fFin = document.getElementById('fechaFin').value;
    const varName = document.getElementById('varSelect').options[document.getElementById('varSelect').selectedIndex].text;

    const ptoData = puntosGuardados.find(p => p.nombre === punto);
    let coordsText = ptoData ? `<br><span style="font-size: 0.75rem; color: #666; font-weight: normal; letter-spacing: 0;">Lat: ${parseFloat(ptoData.lat).toFixed(4)} | Lon: ${parseFloat(ptoData.lon).toFixed(4)}</span>` : '';
    document.getElementById('lblTituloTabla').innerHTML = `${varName.toUpperCase()} - ${vistaActual.toUpperCase()} - ${punto.toUpperCase()} ${coordsText}`;

    actualizarLeyenda();

    const dataPunto = datosTemporales.filter(d => d.punto === punto);
    let columnasVisuales = [];
    let matrizAgrupada = {};

    const modelosUnicos = [...new Set(dataPunto.map(d => d.modelo))];
    modelosUnicos.forEach(m => {
        if (estadoModelos[m] === undefined) estadoModelos[m] = true;
        const grp = dataPunto.find(x => x.modelo === m).grupo;
        matrizAgrupada[m] = { grupo: grp, valores: {} };
    });

    if (vistaActual === 'diario') {
        const dataFiltrada = dataPunto.filter(d => {
            let f_usar = (varSel === 'pp' || varSel === 'et') ? d.fecha_hidro : d.fecha_calendario;
            return f_usar >= fInicio && f_usar <= fFin;
        });

        columnasVisuales = [...new Set(dataFiltrada.map(d => (varSel === 'pp' || varSel === 'et') ? d.fecha_hidro : d.fecha_calendario))].sort();

        modelosUnicos.forEach(mod => {
            columnasVisuales.forEach(dia => {
                const registros = dataFiltrada.filter(d => d.modelo === mod && ((varSel === 'pp' || varSel === 'et') ? d.fecha_hidro === dia : d.fecha_calendario === dia));
                let valsValidos = registros.map(r => r[varSel]).filter(v => v !== null && v !== undefined && !isNaN(v));

                if (valsValidos.length > 0) {
                    if (varSel === 'pp' || varSel === 'et') {
                        matrizAgrupada[mod].valores[dia] = valsValidos.reduce((a,b)=>a+b, 0); // Acumulado
                    } else if (varSel === 'v_vel') {
                        matrizAgrupada[mod].valores[dia] = Math.max(...valsValidos); // MAXIMA RAFAGA (Corrección aplicada)
                    } else if (varSel === 'rad') {
                        let radDiurna = valsValidos.filter(v => v > 0);
                        matrizAgrupada[mod].valores[dia] = radDiurna.length > 0 ? radDiurna.reduce((a,b)=>a+b, 0) / radDiurna.length : 0; // Promedio solo de día
                    } else {
                        matrizAgrupada[mod].valores[dia] = valsValidos.reduce((a,b)=>a+b, 0) / valsValidos.length; // Promedio normal
                    }
                } else {
                    matrizAgrupada[mod].valores[dia] = null;
                }
            });
        });

    } else {
        const dataFiltrada = dataPunto.filter(d => {
            let f_usar = (varSel === 'pp' || varSel === 'et') ? d.fecha_hidro : d.fecha_calendario;
            return f_usar === diaHorarioSeleccionado;
        });
        columnasVisuales = [...new Set(dataFiltrada.map(d => d.hora_str))].sort();

        modelosUnicos.forEach(mod => {
            columnasVisuales.forEach(hora => {
                const reg = dataFiltrada.find(d => d.modelo === mod && d.hora_str === hora);
                matrizAgrupada[mod].valores[hora] = (reg && reg[varSel] !== null && reg[varSel] !== undefined) ? reg[varSel] : null;
            });
        });
    }

    const consenso = {};
    columnasVisuales.forEach(col => {
        let sum = 0, count = 0;
        Object.keys(matrizAgrupada).forEach(mod => {
            if (estadoModelos[mod] === true) {
                const val = matrizAgrupada[mod].valores[col];
                if (val !== null && val !== undefined) { sum += val; count++; }
            }
        });
        consenso[col] = count > 0 ? (sum / count) : null;
    });

    const head = document.getElementById('tableHead');
    let headHTML = `<tr><th>Modelo \\ ${vistaActual === 'diario' ? 'Fecha' : 'Hora'}</th>`;
    columnasVisuales.forEach(col => {
        if (vistaActual === 'diario') {
            const dateObj = new Date(col + 'T00:00:00');
            let formato = dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
            let esHoyClass = (col === fechaHoyString) ? 'class="th-hoy"' : '';
            let esHoyText = (col === fechaHoyString) ? ' <br><span style="font-size:8px;">(Hoy)</span>' : '';
            headHTML += `<th ${esHoyClass} class="th-clic" onclick="verHorario('${col}')" title="Clic para ver horas">${formato}${esHoyText}</th>`;
        } else {
            headHTML += `<th>${col}</th>`;
        }
    });
    headHTML += '</tr>';
    head.innerHTML = headHTML;

    const body = document.getElementById('tableBody');
    let bodyHTML = `<tr class="fila-consenso">
        <th><span class="badge badge-prom">PROM</span>PROMEDIO ACTIVO</th>`;
    columnasVisuales.forEach(col => {
        const val = consenso[col];
        if (val !== null) {
            const colors = getColor(varSel, val, vistaActual);
            bodyHTML += `<td style="background-color: ${colors.bg}; color: ${colors.text};" class="cell-value">${val.toFixed(1)}</td>`;
        } else {
            bodyHTML += `<td class="cell-value cell-null">-</td>`;
        }
    });
    bodyHTML += '</tr>';

    const modelosOrdenados = Object.keys(matrizAgrupada).sort((a, b) => {
        if (matrizAgrupada[a].grupo === 'WRF') return -1;
        if (matrizAgrupada[b].grupo === 'WRF') return 1;
        return (matrizAgrupada[a].grupo || "").localeCompare(matrizAgrupada[b].grupo || "");
    });

    modelosOrdenados.forEach(mod => {
        const info = matrizAgrupada[mod];
        const shortGrupo = (info.grupo || "OTRO").substring(0, 4);
        const isActivo = estadoModelos[mod];
        const rowStyle = isActivo ? "" : "color: #b0b0b0;";
        const badgeOpacity = isActivo ? "1" : "0.4";
        const icon = isActivo ? "fa-toggle-on" : "fa-toggle-off";
        const colorIcon = isActivo ? "color: #27ae60;" : "color: #ccc;";

        bodyHTML += `<tr>
            <th style="text-align:left; ${rowStyle}">
                <i class="fa-solid ${icon}" style="${colorIcon} cursor:pointer; margin-right:5px;" onclick="toggleModelo('${mod}')" title="ON/OFF"></i>
                <span class="badge ${getBadgeClass(info.grupo)}" style="opacity: ${badgeOpacity};">${shortGrupo}</span>
                ${mod}
            </th>`;

        columnasVisuales.forEach(col => {
            const cellVal = info.valores[col];
            if (cellVal !== null && cellVal !== undefined) {
                let colors = getColor(varSel, cellVal, vistaActual);
                if (!isActivo) colors = { bg: '#fafafa', text: '#ccc', cssClass: '' };
                bodyHTML += `<td style="background-color: ${colors.bg}; color: ${colors.text};" class="cell-value ${colors.cssClass}">${cellVal.toFixed(1)}</td>`;
            } else {
                bodyHTML += `<td class="cell-value cell-null">-</td>`;
            }
        });
        bodyHTML += '</tr>';
    });

    body.innerHTML = bodyHTML;

    if(typeof renderComparativos === 'function') renderComparativos();
}

function descargarCSV() {
    const punto = document.getElementById('puntoSelect').value;
    const varSel = document.getElementById('varSelect').options[document.getElementById('varSelect').selectedIndex].text;
    if(!punto) return;

    let csv = [`"Reporte de Datos - ${punto}"`, `"Variable: ${varSel}"`, `"Vista: ${vistaActual}"`, ""];
    let table = document.getElementById("heatmapTable");

    for (let i = 0; i < table.rows.length; i++) {
        let row = [];
        let cols = table.rows[i].querySelectorAll("td, th");
        for (let j = 0; j < cols.length; j++) {
            let texto = cols[j].innerText.replace(/\r\n|\n|\r/g, " ").trim();
            if(j === 0 && i > 0) texto = texto.replace(/PROM/g, "").replace(/GFS/g, "").replace(/ICON/g, "").replace(/ECMW/g, "").trim();
            row.push('"' + texto + '"');
        }
        csv.push(row.join(","));
    }

    let csvFile = new Blob([csv.join("\n")], {type: "text/csv;charset=utf-8;"});
    let link = document.createElement("a");
    link.href = URL.createObjectURL(csvFile);
    link.download = `Data_${punto.replace(/\s+/g, '_')}_${vistaActual}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ========================================================
// 5. COMPONENTES EXTRA Y CONTROLES DE VENTANA
// ========================================================
function initCheckboxesAnalitica() {
    let htmlMod = '';
    configModelos.forEach((m) => {
        let isChecked = m.label.includes('GFS_GLOBAL') ? 'checked' : '';
        htmlMod += `<label class="chk-item"><input type="checkbox" class="chk-modelo" value="${m.label}" onchange="renderComparativos()" ${isChecked}> ${m.label} <span style="font-size:8px; color:#888;">(${m.group})</span></label>`;
    });
    htmlMod += `<label class="chk-item"><input type="checkbox" class="chk-modelo" value="WRF_AMBIAND" onchange="renderComparativos()" checked> WRF_AMBIAND <span style="font-size:8px; color:#888;">(WRF)</span></label>`;
    document.getElementById('chkModelos').innerHTML = htmlMod;

    let htmlVar = '';
    if (typeof variablesFijas !== 'undefined') {
        variablesFijas.forEach((v) => {
            let isChecked = v.id === 'pp' ? 'checked' : '';
            htmlVar += `<label class="chk-item"><input type="checkbox" class="chk-var" value="${v.id}" onchange="renderComparativos()" ${isChecked}> <span style="display:inline-block;width:10px;height:10px;background:${v.colorBase};margin-right:5px;border-radius:2px;"></span> ${v.label}</label>`;
        });
        document.getElementById('chkVariables').innerHTML = htmlVar;
    }
}

// Ventanas y cambio de vistas
window.toggleModelo = function(nombreModelo) {
    estadoModelos[nombreModelo] = !estadoModelos[nombreModelo];
    renderTable();
};

window.verHorario = function(fechaDia) {
    vistaActual = 'horario';
    diaHorarioSeleccionado = fechaDia;
    document.getElementById('btnVolverDiario').style.display = 'inline-block';
    // Muestra el input de comparación histórica
    const divComp = document.getElementById('contenedorComparacion');
    if(divComp) divComp.style.display = 'block';
    renderTable();
};

window.volverDiario = function() {
    vistaActual = 'diario';
    diaHorarioSeleccionado = null;
    document.getElementById('btnVolverDiario').style.display = 'none';
    // Oculta el input de comparación histórica
    const divComp = document.getElementById('contenedorComparacion');
    if(divComp) divComp.style.display = 'none';
    renderTable();
};

function cerrarVista() {
    document.getElementById('bottomSection').style.display = 'none';
    document.getElementById('analiticaSection').style.display = 'none';
    document.getElementById('divControlesExtra').style.display = 'none';
}