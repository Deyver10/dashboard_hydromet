import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USERS_FILE = os.path.join(BASE_DIR, 'data', 'users.txt')


def verify_credentials(username, password):
    if not os.path.exists(USERS_FILE):
        return False

    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or ',' not in line:
                continue
            user_txt, pass_txt = line.split(',', 1)
            if user_txt.strip() == username and pass_txt.strip() == password:
                return True
    return False