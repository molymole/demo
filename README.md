# demo

Demo project for an AI Foundry-connected mortgage document processing workflow.

## What is included

- A browser-based document upload experience for mortgage document packs
- Foundry-style case intelligence payload preparation for:
  - document classification
  - case completeness checks
  - structured extraction
  - reviewer risk flags
- A voice-enabled employee chatbot for checking case status and risks

## Demo architecture

The demo mirrors the proposed flow:

1. **Case ingest** — Europace UI, upload API, or demo upload folder receives the mortgage document pack
2. **Document AI** — Document Intelligence / Content Understanding classifies files and extracts fields
3. **Foundry agent** — orchestrates extraction, rule checks, context retrieval, and case summary generation
4. **Business-rule/API tools** — simulate underwriting pre-checks, completeness validation, and product criteria checks
5. **Evaluation/observability** — emits a simple per-step trace with status and reviewer follow-up signals
6. **Output** — returns structured JSON, completeness status, missing documents, plausibility flags, and reviewer notes

## Run locally

Because this repository is intentionally dependency-free, you can open the app directly in a browser or serve it locally:

```bash
cd /home/runner/work/demo/demo
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
