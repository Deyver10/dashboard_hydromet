// Variables globales para el mapa y los marcadores
let map;
let tempMarker = null;
let markerClic = null;

// Inicializa el mapa (se llama desde main.js al cargar la página)
function initMap() {
    // Coordenadas iniciales (Centro de Perú por defecto)
    map = L.map('map').setView([-9.19, -75.01], 5);

    // Capa base de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Agregamos el buscador de lugares (Geocoder)
    L.Control.geocoder({
        defaultMarkGeocode: false,
        placeholder: "Buscar ciudad o lugar..."
    }).on('markgeocode', function(e) {
        map.fitBounds(e.geocode.bbox);
    }).addTo(map);

    // Evento: Clic en el mapa para capturar coordenadas
    map.on('click', function(e) {
        const select = document.getElementById('puntoSelect');
        select.value = "TEMP_NUEVO_PUNTO";

        // Llamamos a la función de main.js para cambiar la vista de los paneles
        if(typeof handlePuntoSelection === 'function') {
            handlePuntoSelection();
        }

        // Rellenar los inputs con las coordenadas clickeadas
        document.getElementById('tempLat').value = e.latlng.lat.toFixed(4);
        document.getElementById('tempLon').value = e.latlng.lng.toFixed(4);
        document.getElementById('tempNombre').focus();

        // Actualizar el marcador temporal en el mapa
        if (markerClic) map.removeLayer(markerClic);
        markerClic = L.marker([e.latlng.lat, e.latlng.lng]).addTo(map);
        markerClic.bindPopup(`<b>Lat:</b> ${e.latlng.lat.toFixed(4)}<br><b>Lon:</b> ${e.latlng.lng.toFixed(4)}`).openPopup();
    });
}

// Función para centrar el mapa cuando seleccionas un punto ya guardado
function focusMapa(lat, lon, popupText) {
    map.setView([lat, lon], 9);

    if (tempMarker) map.removeLayer(tempMarker);
    if (markerClic) map.removeLayer(markerClic);

    tempMarker = L.marker([lat, lon]).addTo(map).bindPopup(`<b>${popupText}</b>`).openPopup();

    // Forzamos a Leaflet a recalcular su tamaño (útil cuando se ocultan/muestran paneles)
    setTimeout(() => { map.invalidateSize(); }, 400);
}