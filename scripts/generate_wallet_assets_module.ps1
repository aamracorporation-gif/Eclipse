$ErrorActionPreference = "Stop"
# The canonical generator writes artwork and its complete multi-scale module together.
node scripts/generate_eclipse_wallet_assets.mjs
if ($LASTEXITCODE -ne 0) { throw "Wallet artwork generation failed" }
