import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
// ... outras importações ...

// Procura a rota onde inicias a conexão SSE (provavelmente app.get('/sse', ...))
app.get('/sse', async (req, res) => {
    console.log("🔗 Nova conexão SSE recebida do n8n!");

    try {
        // CORREÇÃO:
        // O SSEServerTransport precisa de dois argumentos:
        // 1. O caminho para onde as mensagens POST serão enviadas (ex: "/messages")
        // 2. O objeto 'res' do Express para manter a conexão aberta
        
        const transport = new SSEServerTransport("/messages", res);

        // Agora conectamos o servidor ao transporte
        await server.connect(transport);

        // O transporte trata de fechar a conexão quando necessário,
        // mas é boa prática lidar com o fecho do cliente:
        req.on('close', () => {
             console.log("Conexão SSE fechada pelo cliente");
             // Opcional: lógica de limpeza se necessário
        });

    } catch (error) {
        console.error("Erro na conexão SSE:", error);
        // Se ainda não tiverem sido enviados cabeçalhos, enviamos erro 500
        if (!res.headersSent) {
            res.status(500).send("Erro interno no servidor SSE");
        }
    }
});

// Nota: Certifica-te que tens também a rota POST para as mensagens
app.post('/messages', async (req, res) => {
    console.log("📩 Mensagem recebida via POST");
    // O SDK geralmente trata disto através de handlePostMessage, 
    // mas depende da tua implementação específica do server.
    // Exemplo comum:
    // await server.handlePostMessage(req, res, transport_instanciado_anteriormente);
    // (A gestão do POST depende de como estás a gerir a sessão, mas o erro atual é no GET /sse)
});
