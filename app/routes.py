from flask import render_template, request, redirect, url_for, session, flash, jsonify
import json
import os
import glob
import pandas as pd
import numpy as np
import xarray as xr
from app.auth import verify_credentials

# ========================================================
# CONFIGURACIÓN DE RUTAS PRINCIPALES Y ENTORNO
# ========================================================
# Definimos el directorio base dinámicamente para que Flask encuentre la carpeta 'data'
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# UBICACIÓN DE LA CARPETA WRF (Ruta absoluta local)
CARPETA_WRF = "C:/Users/DeyverMallqui/Downloads/Dashboard"
PATH_WRF = f"{CARPETA_WRF}/wrfout_d01_*"

# CONFIGURACIÓN DE ENSAMBLES METEOROLÓGICOS (Open-Meteo)
CONFIG_MODELOS = [
    {"api_name": "icon_global", "label": "ICON_GLOBAL", "days": 8, "group": "ICON"},
    {"api_name": "gfs_global", "label": "GFS_GLOBAL", "days": 16, "group": "GFS"},
    {"api_name": "ncep_aigfs025", "label": "GFS_AI", "days": 16, "group": "GFS"},
    {"api_name": "gfs_graphcast025", "label": "GFS_GRA", "days": 16, "group": "GFS"},
    {"api_name": "arpege_world", "label": "ARPEGE_GLOBAL", "days": 5, "group": "ARPEGE"},
    {"api_name": "best_match", "label": "ARPEGE_BESMATCH", "days": 7, "group": "ARPEGE"},
    {"api_name": "ecmwf_ifs", "label": "ECMWF_9KM", "days": 15, "group": "ECMWF"},
    {"api_name": "ecmwf_ifs025", "label": "ECMWF_25KM", "days": 15, "group": "ECMWF"},
    {"api_name": "ukmo_global_deterministic_10km", "label": "UKMO_GLOBAL", "days": 7, "group": "UKMO"},
    {"api_name": "kma_gdps", "label": "KMA_GLOBAL", "days": 12, "group": "KMA"},
    {"api_name": "jma_gsm", "label": "GSM_GLOBAL", "days": 11, "group": "JMA"},
    {"api_name": "gem_seamless", "label": "GEM_GLOBAL", "days": 11, "group": "GEM"},
    {"api_name": "cma_grapes_global", "label": "CMA_GRAPES", "days": 11, "group": "CMA"}
]


def init_app(app):
    # ========================================================
    # VISTAS PRINCIPALES Y AUTENTICACIÓN
    # ========================================================
    @app.route('/')
    def index():
        if 'usuario' not in session:
            return redirect(url_for('login'))
        return render_template('index.html',
                               usuario=session['usuario'],
                               modelos_json=json.dumps(CONFIG_MODELOS))

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if 'usuario' in session:
            return redirect(url_for('index'))

        if request.method == 'POST':
            username = request.form.get('username')
            password = request.form.get('password')

            if verify_credentials(username, password):
                session['usuario'] = username
                return redirect(url_for('index'))
            else:
                flash("Usuario o contraseña incorrectos", "error")

        return render_template('login.html')

    @app.route('/logout')
    def logout():
        session.pop('usuario', None)
        return redirect(url_for('login'))

    # ========================================================
    # API: PROCESAMIENTO LOCAL DE WRF (NetCDF)
    # ========================================================
    @app.route('/api/wrf')
    def api_wrf():
        try:
            lat = float(request.args.get('lat'))
            lon = float(request.args.get('lon'))
        except (TypeError, ValueError):
            return jsonify({"error": "Coordenadas inválidas"})

        archivos_nc = sorted(glob.glob(PATH_WRF))
        if not archivos_nc:
            print("Advertencia: No se encontraron archivos .nc de WRF.")
            return jsonify({})

        ultimo_archivo = archivos_nc[-1]

        try:
            ds = xr.open_dataset(ultimo_archivo)

            # Cálculo de distancia euclidiana para hallar el punto de grilla más cercano
            dist = np.sqrt((ds.XLAT.isel(Time=0) - lat) ** 2 + (ds.XLONG.isel(Time=0) - lon) ** 2)
            j, i = np.unravel_index(np.argmin(dist.values), dist.shape)

            # Lluvia acumulada total (Convectiva + No Convectiva)
            rain_cum = (ds.RAINC.isel(south_north=j, west_east=i) + ds.RAINNC.isel(south_north=j, west_east=i)).values

            # Ajuste horario de UTC a hora local de Perú (UTC-5)
            times_utc = pd.to_datetime(ds.XTIME.values)
            times_peru = times_utc - pd.Timedelta(hours=5)

            # Diferencia (np.diff) para obtener la lluvia horaria instantánea
            rain_inst = np.diff(rain_cum)
            df_inst = pd.DataFrame({'time_peru': times_peru[1:], 'precip': rain_inst})
            df_inst['fecha_hora_str'] = df_inst['time_peru'].dt.strftime('%Y-%m-%d %H:%M')

            resultado = {"horario": {}}
            for _, row in df_inst.iterrows():
                # Filtro para evitar valores negativos causados por ruido numérico del modelo
                val_pp = float(row['precip'])
                resultado["horario"][row['fecha_hora_str']] = val_pp if val_pp > 0 else 0.0

            ds.close()
            return jsonify(resultado)

        except Exception as e:
            print(f"Error procesando WRF local: {e}")
            return jsonify({})

    # ========================================================
    # API: GESTIÓN DE PUNTOS POR USUARIO (MINI BASE DE DATOS JSON)
    # ========================================================
    PUNTOS_FILE = os.path.join(BASE_DIR, 'data', 'puntos_usuarios.json')

    def cargar_puntos_db():
        if not os.path.exists(PUNTOS_FILE):
            return {}
        with open(PUNTOS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)

    def guardar_puntos_db(data):
        # Aseguramos que la carpeta 'data' exista antes de guardar
        os.makedirs(os.path.dirname(PUNTOS_FILE), exist_ok=True)
        with open(PUNTOS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)

    @app.route('/api/puntos', methods=['GET'])
    def get_puntos():
        if 'usuario' not in session:
            return jsonify([])  # Si no hay sesión, devolvemos lista vacía

        usuario_actual = session['usuario']
        db = cargar_puntos_db()
        return jsonify(db.get(usuario_actual, []))

    @app.route('/api/puntos/nuevo', methods=['POST'])
    def save_punto():
        if 'usuario' not in session:
            return jsonify({"error": "No autorizado"}), 401

        usuario_actual = session['usuario']
        nuevo_punto = request.json  # Recibe {nombre, lat, lon}

        db = cargar_puntos_db()
        if usuario_actual not in db:
            db[usuario_actual] = []

        # Revisar si el punto ya existe para actualizar sus coordenadas
        for p in db[usuario_actual]:
            if p['nombre'].lower() == nuevo_punto['nombre'].lower():
                p['lat'] = nuevo_punto['lat']
                p['lon'] = nuevo_punto['lon']
                guardar_puntos_db(db)
                return jsonify({"status": "actualizado"})

        # Si no existe, lo agregamos como un punto nuevo
        db[usuario_actual].append(nuevo_punto)
        guardar_puntos_db(db)
        return jsonify({"status": "creado"})

    @app.route('/api/puntos/eliminar', methods=['POST'])
    def eliminar_punto():
        if 'usuario' not in session:
            return jsonify({"error": "No autorizado"}), 401

        usuario_actual = session['usuario']
        data = request.json  # Recibe { "nombre": "Nombre del Punto" }
        nombre_a_eliminar = data.get('nombre')

        if not nombre_a_eliminar:
            return jsonify({"error": "Nombre no proporcionado"}), 400

        db = cargar_puntos_db()

        if usuario_actual in db:
            # Filtramos la lista conservando solo los puntos que NO coinciden con el nombre enviado
            db[usuario_actual] = [p for p in db[usuario_actual] if p['nombre'].lower() != nombre_a_eliminar.lower()]
            guardar_puntos_db(db)
            return jsonify({"status": "eliminado"})

        return jsonify({"error": "Usuario sin puntos"}), 404