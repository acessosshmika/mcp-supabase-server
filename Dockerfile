# Usa uma imagem leve do Node.js
FROM node:20-alpine

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependência primeiro (para aproveitar o cache)
COPY package.json ./

# Instala as dependências
RUN npm install

# Copia o resto do código
COPY . .

# Expõe a porta 3000
EXPOSE 3000

# Comando para iniciar
CMD ["npm", "start"]
