import http.server
import ssl
import os

SERVER_ADDRESS = '0.0.0.0'
SERVER_PORT = 8080

KEY_FILE = '../backend/key.pem'
CERT_FILE = '../backend/cert.pem'

script_dir = os.path.dirname(os.path.abspath(__file__))
keyfile_path = os.path.join(script_dir, KEY_FILE)
certfile_path = os.path.join(script_dir, CERT_FILE)

if not os.path.exists(keyfile_path):
    exit(1)
if not os.path.exists(certfile_path):
    exit(1)

httpd = http.server.HTTPServer((SERVER_ADDRESS, SERVER_PORT), http.server.SimpleHTTPRequestHandler)

httpd.socket = ssl.wrap_socket(
    httpd.socket,
    keyfile=keyfile_path,
    certfile=certfile_path,
    server_side=True
)

print(f"Serving HTTPS on {SERVER_ADDRESS} port {SERVER_PORT}...")
httpd.serve_forever()