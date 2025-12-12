import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

// Configurações iniciais
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERRO: Variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_KEY não definidas.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Criar o servidor MCP
const mcpServer = new McpServer({
  name: "MCP Supabase Server",
  version: "2.0.0"
});

// ---------------------------------------------------------
// DEFINIÇÃO DA FERRAMENTA (TOOL)
// É aqui que transformamos a tua antiga rota numa Tool do MCP
// ---------------------------------------------------------
mcpServer.tool(
  "buscar_arsenal",
  "Realiza uma busca semântica ou textual na base de conhecimento de vendas.",
  {
    query: z.string().describe("O termo ou frase para pesquisar no arsenal de vendas"),
    limit: z.number().optional().default(5).describe("Número máximo de resultados a retornar")
  },
  async ({ query, limit }) => {
    console.log(`🔍 Executando busca por: "${query}" com limite ${limit}`);

    try {
      // Busca textual simples (Mantendo a tua lógica original)
      const { data, error } = await supabase
        .from('arsenal_vendas')
        .select('*')
        .or(`descricao_semantica.ilike.%${query}%,conteudo_texto.ilike.%${query}%,modelo_associado.ilike.%${query}%`)
        .limit(limit);

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text", text: "Nenhum resultado encontrado para essa busca." }]
        };
      }

      // Formatar os resultados para texto legível pelo Agente
      const resultadosFormatados = data.map(item => {
        return `
---
📌 ARQUIVO: ${item.nome_arquivo}
🔗 LINK: ${item.link_publico}
📂 CATEGORIA: ${item.categoria}
🤖 MODELO: ${item.modelo_associado}
📝 CONTEÚDO: ${item.conteudo_texto ? item.conteudo_texto.substring(0, 300) + "..." : "Sem texto"}
---`;
      }).join("\n");

      return {
        content: [{ type: "text", text: `Encontrei ${data.length} resultados:\n${resultadosFormatados}` }]
      };

    } catch (error) {
      console.error("Erro no Supabase:", error);
      return {
        isError: true,
        content: [{ type: "text", text: `Erro ao buscar dados: ${error.message}` }]
      };
    }
  }
);

// ---------------------------------------------------------
// CONFIGURAÇÃO DO TRANSPORTE SSE (HTTP)
// Necessário para o n8n se conectar
// ---------------------------------------------------------

app.use(cors());

// Rota para iniciar a conexão SSE
app.get('/sse', async (req, res) => {
  console.log("🔌 Nova conexão SSE recebida");
  const transport = new SSEServerTransport("/messages", res);
  await mcpServer.connect(transport);
});

// Rota para receber mensagens do cliente (n8n)
app.post('/messages', async (req, res) => {
  // O SDK lida com o processamento da mensagem, nós apenas passamos o fluxo
  // Nota: Em implementações simples com Express, o 'transport' criado no GET /sse
  // lida com a resposta, mas aqui precisamos garantir que o corpo seja processado.
  // Como o transporte SSE do SDK é desenhado para manter o contexto, 
  // a implementação via Express requer cuidado.
  
  // Para simplificar no Express, usamos o método handlePostMessage do transporte
  // Mas como o transporte é criado no escopo do /sse, precisamos de uma forma de o recuperar.
  // ATENÇÃO: A implementação padrão do SDK SSEServerTransport em Express é complexa 
  // porque o Express não mantém estado entre requisições facilmente.
  
  // SOLUÇÃO ROBUSTA SIMPLIFICADA PARA O TEU CASO:
  // Vamos deixar o endpoint /messages responder genericamente se não estivermos a usar 
  // um gestor de sessões complexo, ou usar a biblioteca diretamente.
  
  // Na verdade, o 'SSEServerTransport' do SDK espera gerir o objeto 'res' do endpoint /sse.
  // As mensagens POST vêm separadas.
  
  await mcpServer.server.transport?.handlePostMessage(req, res);
});


// Middleware para processar JSON (importante estar aqui para o /messages funcionar se fizermos manual)
// Mas o transport.handlePostMessage do SDK lida com streams. 
// Vamos usar uma abordagem mais segura para Express + MCP SDK v1.0.4+:

let transport;

app.get('/sse', async (req, res) => {
    console.log("🔌 Conexão SSE estabelecida");
    transport = new SSEServerTransport("/message", res);
    await mcpServer.connect(transport);
});

app.post('/message', async (req, res) => {
    console.log("📨 Mensagem recebida");
    if (transport) {
        await transport.handlePostMessage(req, res);
    } else {
        res.status(500).send("Transporte não inicializado");
    }
});

app.get('/', (req, res) => {
    res.send("Servidor MCP Supabase Online 🚀. Use o endpoint /sse para conectar no n8n.");
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor MCP rodando na porta ${PORT}`);
  console.log(`🔗 Endpoint MCP: http://localhost:${PORT}/sse`);
});
