# Usa uma imagem leve do Node
FROM node:18-alpine

# Cria a pasta de trabalho
WORKDIR /app

# Copia os ficheiros de dependências
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o resto do código
COPY . .

# Expõe a porta 3000
EXPOSE 3000

# Inicia o servidor explicitamente
CMD ["node", "server.js"]
