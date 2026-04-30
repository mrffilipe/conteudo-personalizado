/**
 * Texto enviado ao modelo junto com as instruções: dados da linha + situação do site.
 * Sempre inclui uma frase sobre o site, para o modelo não supor conteúdo inexistente.
 */
export function buildLeadUserDataBlock(leadData: Record<string, unknown>, scrapedContent?: string): string {
  const leadDataJson = JSON.stringify(leadData, null, 2);
  const siteBlock = scrapedContent?.trim()
    ? `Conteúdo extraído do site do cliente: ${scrapedContent.trim()}`
    : `Conteúdo extraído do site do cliente: [AUSENTE] Não há resumo de site para esta linha. Isso costuma indicar que o cliente não tem site utilizável nos dados enviados (URL ausente ou vazia), que o enriquecimento por site está desligado na aplicação, ou que a página existente não pôde ser lida. Não invente fatos sobre o site; use somente os dados da planilha.`;
  return `Dados da Planilha: ${leadDataJson} | ${siteBlock}`;
}
