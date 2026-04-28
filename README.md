# Conteúdo Personalizado

Aplicação web para geração de conteúdo personalizado em massa usando Inteligência Artificial. Processa planilhas Excel/CSV e gera conteúdos customizados para cada linha utilizando prompts configuráveis.

## Funcionalidades

- **Processamento de Planilhas**: Suporte a arquivos `.xlsx`, `.xls` e `.csv` (até 10.000 linhas)
- **Múltiplos Provedores de AI**: OpenAI (GPT), Anthropic (Claude) e Google (Gemini)
- **Geração em Lote**: Processamento paralelo com controle de concorrência dinâmico
- **Exportação de Resultados**: Download em formato `.xlsx` ou `.csv`
- **Configuração de Prompts**: Base de conhecimento (system) e instruções personalizáveis (user)
- **Seleção de Colunas**: Escolha quais colunas da planilha serão enviadas como dados para a AI
- **Rate Limiting Inteligente**: Controle automático de requisições com retry e backoff exponencial
- **Monitoramento de Progresso**: Acompanhamento em tempo real do processamento

## Tecnologias

- **Frontend**: React 18 + TypeScript
- **Build**: Vite 5 com SWC para compilação rápida
- **Estilização**: Tailwind CSS 3.4
- **Processamento de Planilhas**: SheetJS (xlsx)
- **SDKs de AI**:
  - OpenAI SDK v0.71
  - Anthropic SDK v0.71
  - Google GenAI SDK v1.38

## Arquitetura

### Estrutura do Projeto

```
src/
├── App.tsx                    # Componente principal (UI e estado)
├── main.tsx                   # Entry point React
├── index.css                  # Estilos globais + Tailwind
├── lib/
│   ├── ai-settings.ts         # Interfaces e configurações padrão de AI
│   ├── ai-content-service.ts  # Orquestração do processamento em lote
│   ├── openai-service.ts      # Integração com OpenAI
│   ├── claude-service.ts      # Integração com Anthropic Claude
│   ├── gemini-service.ts      # Integração com Google Gemini
│   └── parseSpreadsheet.ts    # Parser de Excel/CSV
```

### Fluxo de Processamento

1. **Upload**: Usuário seleciona arquivo Excel/CSV
2. **Parsing**: `parseSpreadsheet.ts` extrai linhas e colunas
3. **Configuração**: Usuário define provedor, modelo, temperatura, max tokens e prompts
4. **Mapeamento**: Colunas selecionadas são convertidas em objetos `Lead`
5. **Processamento**: `ai-content-service.ts` orquestra o processamento em lotes
6. **Exportação**: Resultados são exportados em XLSX ou CSV

### Sistema de Processamento em Lote

O `ai-content-service.ts` implementa processamento paralelo inteligente:

- **Tamanho de Batch**: Ajustável por modelo (50 para Gemini Flash, 30 para modelos leves, 5 para modelos pesados)
- **Concorrência Dinâmica**: Adapta-se automaticamente baseado na taxa de sucesso
- **Retry com Backoff**: Até 5 tentativas com espera exponencial (1s, 2s, 4s, 8s...)
- **Rate Limiting**: Respeita headers `retry-after` das APIs

## Instalação

```bash
# Clone o repositório
git clone <repo-url>
cd conteudo-personalizado

# Instale as dependências
npm install

# Configure as variáveis de ambiente (opcional)
cp .env.example .env
# Edite .env com suas API keys
```

## Configuração

### Variáveis de Ambiente (.env)

```env
VITE_OPENAI_API_KEY=sk-...          # Opcional - pode inserir na interface
VITE_ANTHROPIC_API_KEY=sk-ant-...   # Opcional - pode inserir na interface
VITE_GEMINI_API_KEY=AIza...         # Opcional - pode inserir na interface
```

> **Nota**: As chaves também podem ser inseridas diretamente na interface da aplicação. O uso de `.env` é recomendado para desenvolvimento local.

### Scripts

```bash
npm run dev      # Inicia servidor de desenvolvimento (porta 5173)
npm run build    # Compila para produção (TypeScript + Vite)
npm run preview  # Preview da build de produção
```

## Uso

### 1. Configurar Contexto

- **Base de Conhecimento (System Prompt)**: Defina a persona da AI, tom de voz, informações sobre a marca/produto
- **Instrução (User Prompt)**: O que gerar para cada linha (ex: "Escreva um e-mail frio de no máximo 120 palavras...")

### 2. Selecionar Provedor e Modelo

| Provedor | Modelo Padrão | Opções |
|----------|---------------|--------|
| OpenAI | `gpt-4o-mini` | Qualquer modelo da OpenAI |
| Claude | `claude-sonnet-4-5` | claude-sonnet-4-5, claude-haiku-4-5, claude-opus-4-5 |
| Gemini | `gemini-2.5-flash` | Qualquer modelo Gemini |

### 3. Ajustar Parâmetros

- **Temperature** (0-2): Criatividade da resposta (0 = mais determinístico, 2 = mais criativo)
- **Max Tokens**: Limite máximo de tokens na resposta (recomendado: 1000-2000)

### 4. Carregar Planilha

Formatos suportados: `.xlsx`, `.xls`, `.csv`

A primeira linha deve conter os cabeçalhos. Exemplo:

| first_name | company_name | job_title | email |
|------------|--------------|-----------|-------|
| João | Acme Inc | CEO | joao@acme.com |
| Maria | TechCorp | CTO | maria@tech.com |

### 5. Selecionar Colunas

Após carregar, selecione quais colunas serão enviadas como dados do lead para a AI.

### 6. Gerar e Exportar

Clique em "Gerar conteúdo" e aguarde o processamento. Os resultados podem ser baixados em XLSX ou CSV.

## Modelos Suportados

### OpenAI
- `gpt-4o-mini` (recomendado para custo/benefício)
- `gpt-4o`
- `gpt-4-turbo`
- `gpt-3.5-turbo`

### Claude (Anthropic)
- `claude-sonnet-4-5` (padrão, mapeado automaticamente)
- `claude-haiku-4-5`
- `claude-opus-4-5`

Aliases suportados: `claude-3-5-sonnet-20241022`, `claude-3-7-sonnet-20250219`, etc.

### Gemini (Google)
- `gemini-2.5-flash` (padrão, mais rápido)
- `gemini-2.0-flash`
- `gemini-1.5-flash`
- `gemini-1.5-pro`

## Otimizações por Provedor

### Gemini Flash
- **Batch Size**: 50 leads por batch
- **Concorrência**: Até 16 requisições simultâneas
- **Rate Limit**: 0ms entre requisições (otimizado para velocidade)

### Modelos Leves (mini, haiku, flash-lite)
- **Batch Size**: 30 leads
- **Concorrência**: Até 10 requisições
- **Rate Limit**: 20ms entre requisições

### Modelos Pesados (GPT-4, Claude Opus)
- **Batch Size**: 5 leads
- **Concorrência**: 2 requisições
- **Rate Limit**: 100ms entre requisições

## Segurança e Considerações

⚠️ **Aviso Importante**: Esta aplicação executa as chamadas às APIs de AI diretamente no navegador do cliente. Isso significa que:

1. **API keys são expostas** no frontend - qualquer usuário pode inspecionar e ver a chave
2. Para uso em produção, **recomenda-se implementar um backend** que faça as chamadas às APIs
3. Ideal para uso interno/pessoal ou com chaves de baixo risco/custo limitado

### Recomendações de Segurança
- Use chaves com limites de gasto (spending caps)
- Monitore o uso das chaves regularmente
- Para ambientes compartilhados, implemente autenticação e proxy no backend

## Limitações

- Máximo de 10.000 linhas por arquivo
- Processamento síncrono no navegador (não usa Web Workers)
- Sem persistência de dados (resultados perdidos ao recarregar)
- Sem histórico de execuções anteriores

## Desenvolvimento

### Estrutura de Tipos Principais

```typescript
// Lead representa uma linha da planilha
interface Lead {
  first_name?: string;
  company_name?: string;
  company_industry?: string;
  job_title?: string;
  location?: string;
  email?: string;
  phone?: string;
  website?: string;
  [key: string]: unknown; // Permite campos customizados
}

// Configurações de AI
interface AISettings {
  systemPrompt: string;
  userInstructions: string;
  temperature: number;
  maxTokens: number;
  aiProvider: "openai" | "claude" | "gemini";
  model: string;
  claudeModel: string;
  geminiModel: string;
  openaiApiKey: string;
  claudeApiKey: string;
  geminiApiKey: string;
  useRealAI: boolean;
}

// Resultado do processamento
interface ProcessingResult {
  success: boolean;
  lead: Lead;
  content?: string;
  error?: string;
  timestamp: string;
  aiModel: string;
  temperature: number;
  index: number;
}
```

### Adicionar Novo Provedor de AI

1. Crie um novo serviço em `src/lib/[novo]-service.ts` seguindo o padrão dos existentes
2. Implemente: `configure()`, `generateContent()`, `chatWithHistory()`, `generateWithPromptOnly()`
3. Adicione o tipo em `AISettings.aiProvider`
4. Atualize `ai-content-service.ts` para rotear para o novo serviço
5. Adicione a UI em `App.tsx` na seção de seleção de provedor

## Licença

MIT

## Créditos

Baseado na lógica do gerador do Belgos CRM, reimplementado como aplicação standalone sem dependência de Firebase ou autenticação.
