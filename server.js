import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// 1. Configuração Inicial e Verificação
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Erro: Faltam as credenciais (URL ou KEY) no ficheiro .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const server = new Server(
  {
    name: 'supabase-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 2. Definir o "Menu" de Ferramentas (Usando o Schema correto para evitar o erro)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ler_tabela",
        description: "Lê dados de uma tabela. Use para consultar informações.",
        inputSchema: {
          type: "object",
          properties: {
            tabela: { type: "string" },
            colunas: { type: "string", description: "Ex: '*' ou 'id, nome'" },
            limite: { type: "number" }
          },
          required: ["tabela"],
        },
      },
      {
        name: "modificar_dados",
        description: "Insere, atualiza ou apaga dados na base de dados.",
        inputSchema: {
          type: "object",
          properties: {
            acao: { type: "string", enum: ["insert", "update", "delete"], description: "Ação a realizar" },
            tabela: { type: "string" },
            dados: { type: "object", description: "Dados JSON para inserir/atualizar" },
            id_alvo: { type: "string", description: "ID da linha (obrigatório para update/delete)" }
          },
          required: ["acao", "tabela"],
        },
      },
      {
        name: "gerar_link_download",
        description: "Gera link para baixar ficheiros do Storage.",
        inputSchema: {
          type: "object",
          properties: {
            bucket: { type: "string", description: "Nome do bucket de arquivos" },
            caminho: { type: "string", description: "Caminho do arquivo dentro do bucket" },
          },
          required: ["bucket", "caminho"],
        },
      },
    ],
  };
});

// 3. Executar as Ferramentas (A Lógica)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // --- FERRAMENTA 1: LER DADOS ---
    if (name === "ler_tabela") {
      const { data, error } = await supabase
        .from(args.tabela)
        .select(args.colunas || "*")
        .limit(args.limite || 10);
      
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    // --- FERRAMENTA 2: MODIFICAR DADOS (CRUD) ---
    if (name === "modificar_dados") {
      let result;
      
      if (args.acao === "insert") {
        result = await supabase.from(args.tabela).insert(args.dados).select();
      } 
      else if (args.acao === "update") {
        if (!args.id_alvo) throw new Error("Precisa de id_alvo para atualizar");
        result = await supabase.from(args.tabela).update(args.dados).eq('id', args.id_alvo).select();
      } 
      else if (args.acao === "delete") {
        if (!args.id_alvo) throw new Error("Precisa de id_alvo para apagar");
        result = await supabase.from(args.tabela).delete().eq('id', args.id_alvo).select();
      }

      if (result.error) throw new Error(result.error.message);
      return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
    }

    // --- FERRAMENTA 3: DOWNLOAD ---
    if (name === "gerar_link_download") {
      const { data, error } = await supabase.storage
        .from(args.bucket)
        .createSignedUrl(args.caminho, 3600); // Link válido por 1 hora
      
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: `Link de download: ${data.signedUrl}` }] };
    }

    throw new Error(`Ferramenta não encontrada: ${name}`);

  } catch (error) {
    return {
      content: [{ type: "text", text: `Erro: ${error.message}` }],
      isError: true,
    };
  }
});

// 4. Iniciar o Servidor
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Servidor Supabase MCP a correr e pronto!");
}

runServer().catch((error) => {
  console.error("Erro fatal no servidor:", error);
  process.exit(1);
});
