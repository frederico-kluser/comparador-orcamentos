#!/usr/bin/env bash
# Builda o instalador NSIS .exe (e versão portable) para Windows x64.
#
# - Em Windows ou Linux: roda nativo. No Linux, electron-builder usa Wine
#   internamente para gerar o instalador NSIS — precisa do pacote `wine`
#   instalado no sistema (ou, em distros Debian/Ubuntu, `wine wine64`).
# - Para assinar o instalador, exportar CSC_LINK (caminho ou base64 do .pfx)
#   e CSC_KEY_PASSWORD antes de rodar.
#
# Saída:
#   release/Comparador de Orcamentos Setup <version>.exe   (instalador)
#   release/Comparador de Orcamentos-<version>-x64.exe     (portable)

set -euo pipefail
cd "$(dirname "$0")/.."

OS="$(uname -s)"
echo "▶ Plataforma host: $OS"

if [[ "$OS" == "Linux" ]]; then
  if ! command -v wine >/dev/null 2>&1; then
    echo "❌ ERRO: 'wine' não encontrado. electron-builder precisa do Wine"
    echo "   para gerar o instalador NSIS no Linux."
    echo "   Pop!_OS / Ubuntu: sudo apt install wine wine64"
    exit 1
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "▶ Instalando dependências (npm ci)…"
  npm ci
fi

echo "▶ Limpando builds anteriores…"
rm -rf dist release

echo "▶ Buildando (Vite + tsc) e empacotando com electron-builder…"
npm run dist:win

echo
echo "✅ Build concluído. Artefatos em ./release/"
ls -lh release/ | grep -E '\.(exe|msi)$' || true
