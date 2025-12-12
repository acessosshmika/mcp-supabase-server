// server.js
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Middleware
app.use(cors());
app.use(express.json());

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Endpoint raiz
app.get('/', (req, res) => {
  res.json({
    nome: 'MCP Supabase Server',
    versao: '2.0.0',
    status: 'online',
    endpoints: {
      '/buscar_arsenal': 'POST - Busca semântica'
    }
  });
});

// Buscar Arsenal
app.post('/buscar_arsenal', async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    
    console.log('Busca:', query);

    if (!query) {
      return res.status(400).json({ erro: 'Query obrigatória' });
    }

    // Por enquanto, busca textual simples (SEM embeddings)
    const { data, error } = await supabase
      .from('arsenal_vendas')
      .select('*')
      .or(`descricao_semantica.ilike.%${query}%,conteudo_texto.ilike.%${query}%,modelo_associado.ilike.%${query}%`)
      .limit(limit);

    if (error) throw error;

    const resultados = (data || []).map(item => ({
      nome_arquivo: item.nome_arquivo,
      link_publico: item.link_publico,
      categoria: item.categoria,
      modelo: item.modelo_associado,
      conteudo_texto: item.conteudo_texto,
      detalhes_visuais: item.detalhes_visuais
    }));

    res.json({
      status: 'sucesso',
      total: resultados.length,
      query,
      resultados
    });

  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ erro: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`);
});
