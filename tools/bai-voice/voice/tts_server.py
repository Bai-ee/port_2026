# Local Kokoro text-to-speech server. Loads the model once, then speaks each POSTed text.
# The request returns only after playback ends, so speak.sh keeps the listener muted until then.
# Run: tts-venv/bin/python tts_server.py   (port 5297, localhost only)
import os, subprocess, tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

import soundfile as sf
from kokoro_onnx import Kokoro

HOME = os.path.dirname(os.path.abspath(__file__))
VOICE = os.environ.get("BAI_VOICE", "af_heart")
SPEED = float(os.environ.get("BAI_SPEED", "1.1"))
kokoro = Kokoro(os.path.join(HOME, "models/kokoro-v1.0.onnx"), os.path.join(HOME, "models/voices-v1.0.bin"))

class Speak(BaseHTTPRequestHandler):
    def do_POST(self):
        text = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8").strip()
        if text:
            samples, rate = kokoro.create(text, voice=VOICE, speed=SPEED, lang="en-us")
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                sf.write(f.name, samples, rate)
            subprocess.run(["afplay", f.name])
            os.unlink(f.name)
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    print(f"kokoro ready on 127.0.0.1:5297 voice={VOICE}", flush=True)
    HTTPServer(("127.0.0.1", 5297), Speak).serve_forever()
