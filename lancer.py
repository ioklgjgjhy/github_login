#!/usr/bin/env python3
"""Lance le simulateur NH90 dans le navigateur (PC / Mac / Linux), sans connexion internet.

    python3 lancer.py          (ou double-clic sur lancer.command / lancer.bat)

Un petit serveur local est nécessaire uniquement pour charger les fichiers du dossier
travail/ (modèle 3D, configuration). Sans ce dossier, un double-clic sur index.html suffit.
"""
import http.server, os, socketserver, sys, threading, webbrowser

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as srv:
    url = f"http://127.0.0.1:{PORT}/index.html"
    print(f"Simulateur NH90 : {url}\nCtrl+C pour arrêter.")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
