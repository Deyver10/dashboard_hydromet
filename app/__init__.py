from flask import Flask

def create_app():
    app = Flask(__name__, template_folder='../templates', static_folder='../static')
    app.secret_key = 'clave_secreta_super_segura_hydromet'

    from app import routes
    routes.init_app(app)

    return app