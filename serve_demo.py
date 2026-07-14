#!/usr/bin/env python3
"""Static demo server with environment-driven runtime config for config.js."""

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent

DEFAULT_CONFIG = {
    "azureFoundryEndpoint": "https://example-resource.openai.azure.com/openai",
    "azureFoundryApiVersion": "2024-05-01-preview",
    "azureFoundryProject": "mortgage-doc-intelligence-demo",
    "azureFoundryAgentId": "financing-document-intelligence",
    "caseIngestEndpoint": "https://demo.local/api/case-ingest",
    "documentAiEndpoint": "https://demo.local/api/document-ai",
    "businessRulesEndpoint": "https://demo.local/api/business-rules",
}

ENV_MAPPING = {
    "azureFoundryEndpoint": "AZURE_FOUNDRY_ENDPOINT",
    "azureFoundryApiVersion": "AZURE_FOUNDRY_API_VERSION",
    "azureFoundryProject": "AZURE_FOUNDRY_PROJECT",
    "azureFoundryAgentId": "AZURE_FOUNDRY_AGENT_ID",
    "caseIngestEndpoint": "CASE_INGEST_ENDPOINT",
    "documentAiEndpoint": "DOCUMENT_AI_ENDPOINT",
    "businessRulesEndpoint": "BUSINESS_RULES_ENDPOINT",
}


def runtime_config() -> dict:
    config = dict(DEFAULT_CONFIG)
    for key, env_name in ENV_MAPPING.items():
        value = os.getenv(env_name)
        if value:
            config[key] = value
    return config


class DemoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def do_GET(self):
        if self.path in ("/config.js", "/config.js?"):
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.end_headers()
            payload = json.dumps(runtime_config(), separators=(",", ":"))
            self.wfile.write(f"window.__DEMO_CONFIG__ = {payload};\n".encode("utf-8"))
            return
        super().do_GET()


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    with ThreadingHTTPServer(("0.0.0.0", port), DemoHandler) as server:
        print(f"Serving demo from {REPO_ROOT} on http://127.0.0.1:{port}")
        server.serve_forever()
