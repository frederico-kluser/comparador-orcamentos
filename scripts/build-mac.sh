#!/usr/bin/env bash
# Builda o instalador .dmg para macOS (x64 + arm64).
#
# - Em macOS: build nativo. Para distribuição via App Store ou notarização
#   precisa de certificado de developer Apple e variáveis CSC_LINK/CSC_KEY_PASSWORD.
# - Em Linux: electron-builder consegue empacotar mas o .dmg sai SEM
#   assinatura — usuários verão "App damaged" no Gatekeeper. Útil só para
#   testes internos. Recomenda-se sempre rodar em macOS para distribuição.
#
# Saída: release/Comparador de Orcamentos-<version>-<arch>.dmg

set -euo pipefail
cd "$(dirname "$0")/.."

OS="$(uname -s)"
echo "▶ Plataforma host: $OS"

if [[ "$OS" != "Darwin" ]]; then
  echo "⚠️  AVISO: Build de macOS fora de macOS gera DMG não-assinado."
  echo "    Para distribuir publicamente, rode este script em um Mac."
  echo
fi

if [[ ! -d node_modules ]]; then
  echo "▶ Instalando dependências (npm ci)…"
  npm ci
fi

echo "▶ Limpando builds anteriores…"
rm -rf dist release

echo "▶ Buildando (Vite + tsc) e empacotando com electron-builder…"
npm run dist:mac

echo
echo "✅ Build concluído. Artefatos em ./release/"
ls -lh release/ | grep -E '\.(dmg|zip)$' || true
