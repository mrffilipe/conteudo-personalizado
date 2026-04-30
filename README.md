# Conteudo Personalizado

Aplicacao para gerar conteudo em lote a partir de planilhas com suporte a OpenAI, Claude, Gemini e LM Studio.

## Nova arquitetura

- Frontend React/Vite faz chamadas de IA diretamente no navegador.
- Backend Express (`server/`) cuida de:
  - scraping (`POST /api/scrape`)
  - checkpoint (`/api/checkpoint/*`)
  - geracao do arquivo final em `data/output`
- Vite faz proxy de `/api` e `/output` para `http://localhost:5000`, e de `/lmstudio` para `http://localhost:1234` (LM Studio, evita CORS no navegador).

## Instalacao

```bash
npm install
cp .env.example .env
```

## Rodando em desenvolvimento

```bash
npm run dev
```

Esse comando sobe:
- web em `http://localhost:3000`
- api em `http://localhost:5000`

## LM Studio (local)

1. Instale o LM Studio e baixe um modelo.
2. Abra a aba **Local Server** e clique em **Start Server** (porta `1234`).
3. Na UI selecione `LM Studio (local)`.
4. Ajuste:
   - **Base URL**: deixe `/lmstudio/v1` (recomendado) — o Vite repassa para `localhost:1234` sem CORS. Se usar `http://localhost:1234/v1` direto no navegador, o browser envia `OPTIONS` e o LM Studio pode responder com erro (`messages` obrigatório) e aparecer **Connection error** na planilha.
   - **Modelo**: o id exato do modelo carregado no LM Studio (ex.: `google/gemma-3-4b` — confira na lista do servidor local).

## Arquivo original e arquivo de saida

- O arquivo original nunca e alterado.
- O backend gera um novo arquivo:
  - `<nome-original>-resultado.xlsx`
  - `<nome-original>-resultado.csv`
- O resultado preserva colunas originais e adiciona:
  - `conteudo_gerado`
  - `erro`
  - `_modelo`
  - `_status`
  - `_site_resumo`

## Recuperacao de falhas

- Checkpoints ficam em `data/checkpoints/<fileId>.json`.
- Ao abrir o mesmo arquivo novamente, a UI oferece:
  - **Retomar**
  - **Recomecar**

## Variaveis de ambiente

```env
VITE_OPENAI_API_KEY=
VITE_ANTHROPIC_API_KEY=
VITE_GEMINI_API_KEY=
VITE_LM_STUDIO_BASE_URL=/lmstudio/v1
API_PORT=5000
SCRAPE_TIMEOUT_MS=8000
SCRAPE_MAX_BYTES=2000000
CHECKPOINT_DIR=./data/checkpoints
OUTPUT_DIR=./data/output
```
