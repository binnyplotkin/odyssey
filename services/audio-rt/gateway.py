from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="odyssey-audio-rt")


class TranscribeRequest(BaseModel):
    audioBase64: str
    mimeType: str


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "audio-rt", "provider": "kyutai", "mode": "bootstrap"}


@app.post("/transcribe")
def transcribe(_: TranscribeRequest):
    raise HTTPException(
        status_code=501,
        detail="Kyutai runtime not wired yet. Service is deployed and reachable.",
    )


@app.post("/speak")
def speak(_: SpeakRequest):
    raise HTTPException(
        status_code=501,
        detail="Kyutai runtime not wired yet. Service is deployed and reachable.",
    )
