import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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

server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'query_table',
        description: 'Consultar dados de uma tabela do Supabase',
        inputSchema: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Nome da tabela' },
            select: { type: 'string', description: 'Colunas (padrão: *)', default: '*' },
            filters: { type: 'object', description: 'Filtros Ex: {id: 1}' },
            limit: { type: 'number', description: 'Limite de resultados', default: 100 },
            orderBy: { type: 'string', description: 'Ordenar por coluna' },
            ascending: { type: 'boolean', description: 'Ordem crescente', default: true }
          },
          required: ['table']
        }
      },
      {
        name: 'insert_data',
        description: 'Inserir dados em uma tabela',
        inputSchema: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Nome da tabela' },
            data: { 
              description: 'Dados (objeto ou array)',
              oneOf: [
                { type: 'object' },
                { type: 'array', items: { type: 'object' } }
              ]
            }
          },
          required: ['table', 'data']
        }
      },
      {
        name: 'update_data',
        description: 'Atualizar dados em uma tabela',
        inputSchema: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Nome da tabela' },
            filters: { type: 'object', description: 'Filtros Ex: {id: 1}' },
            data: { type: 'object', description: 'Novos valores' }
          },
          required: ['table', 'filters', 'data']
        }
      },
      {
        name: 'delete_data',
        description: 'Deletar dados de uma tabela',
        inputSchema: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Nome da tabela' },
            filters: { type: 'object', description: 'Filtros Ex: {id: 1}' }
          },
          required: ['table', 'filters']
        }
      }
    ]
  };
});

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'query_table': {
        let query = supabase.from(args.table).select(args.select || '*');
        
        if (args.filters) {
          Object.entries(args.filters).forEach(([key, value]) => {
            query = query.eq(key, value);
          });
        }
        
        if (args.orderBy) {
          query = query.order(args.orderBy, { ascending: args.ascending !== false });
        }
        
        if (args.limit) {
          query = query.limit(args.limit);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, count: data.length, data }, null, 2)
          }]
        };
      }

      case 'insert_data': {
        const { data, error } = await supabase
          .from(args.table)
          .insert(args.data)
          .select();
        
        if (error) throw error;
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Inserido com sucesso', data }, null, 2)
          }]
        };
      }

      case 'update_data': {
        let query = supabase.from(args.table).update(args.data);
        
        Object.entries(args.filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
        
        const { data, error } = await query.select();
        if (error) throw error;
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Atualizado', updated: data.length, data }, null, 2)
          }]
        };
      }

      case 'delete_data': {
        let query = supabase.from(args.table).delete();
        
        Object.entries(args.filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
        
        const { data, error } = await query.select();
        if (error) throw error;
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Deletado', deleted: data.length, data }, null, 2)
          }]
        };
      }

      default:
        throw new Error(`Ferramenta desconhecida: ${name}`);
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: error.message }, null, 2)
      }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 Servidor MCP Supabase iniciado!');
}

main().catch((error) => {
  console.error('Erro ao iniciar:', error);
  process.exit(1);
});
