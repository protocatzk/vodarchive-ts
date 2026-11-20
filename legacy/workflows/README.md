# n8n-Workflow-Exporte (Referenz)

Hier lagen die Original-Exporte der drei n8n-Workflows
„Streamrecorder Auto-Downloader – … (API-Targets)".

**Wichtig:** Diese Exporte enthalten echte Session-Cookies/JWTs. Sie sind
deshalb per `.gitignore` aus dem öffentlichen Repo ausgeschlossen
(`legacy/workflows/*.json`).

Die Unterlage `sanitized/` enthält bereinigte Kopien (Cookies/Tokens ersetzt),
damit die Workflow-Logik nachvollziehbar bleibt.

Die native Umsetzung liegt in `src/backend/sources/streamrecorder.ts` und
bildet die Workflows ohne n8n ab:

1. `GET /userrecordings` (HTML) → Targets/Accounts einlesen
2. `GET /api/user/recordingsv2?targetid=…` (JSON) → fertige, nicht
   heruntergeladene Aufnahmen
3. Upload über die interne Pipeline
4. `GET /api/user/setdownloaded?fileid=…` nach erfolgreichem Upload

Bitte nach dem Umstieg die Streamrecorder-Session rotieren.
