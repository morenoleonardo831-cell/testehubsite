# Moreno Móveis - Site completo

Projeto funcional com backend, frontend e banco de dados para loja de móveis.

## Recursos
- Cadastro completo de clientes
- Login com JWT
- Catálogo de produtos
- Painel admin para criação de produtos
- Carrinho de compras
- Pedidos enviados automaticamente para fechamento no WhatsApp da loja
- Baixa de estoque somente quando o admin marca `Venda finalizada`
- Banco de dados SQLite local (`moreno_moveis.db`)

## Tecnologias
- Node.js 24
- Express
- SQLite nativo (`node:sqlite`)
- HTML, CSS e JavaScript no frontend

## Como rodar
1. Instale dependências:
   ```bash
   npm install
   ```
2. Copie o arquivo de ambiente:
   ```bash
   copy .env.example .env
   ```
3. Inicie o projeto:
   ```bash
   npm run dev
   ```
   Para modo watch (quando suportado no ambiente):
   ```bash
   npm run dev:watch
   ```
4. Acesse:
   ```
   http://localhost:3000
   ```

## Conta admin inicial
- Configure no `.env`:
  - `ADMIN_SEED_EMAIL`
  - `ADMIN_SEED_PASSWORD` (min. 8 caracteres)
- A conta e criada automaticamente apenas se ainda nao existir no banco.

## Observação de pagamento
- O site registra o pedido e envia os dados completos para o WhatsApp da loja.
- O pagamento é combinado e finalizado diretamente no WhatsApp com o cliente.

## Deploy (Backend + Frontend)

### 1) Backend no Render
- Crie um `Web Service` apontando para este repositório.
- Build command: `npm install`
- Start command: `npm start`
- Configure as variáveis:
  - `NODE_ENV=production`
  - `JWT_SECRET=<uma-chave-forte>`
  - `CORS_ORIGIN=https://morenoleonardo831-cell.github.io`
  - `ADMIN_SEED_EMAIL=<seu-email-admin>`
  - `ADMIN_SEED_PASSWORD=<senha-forte>`
  - `DB_PATH=/var/data/moreno_moveis.db`
- Adicione um disco persistente no Render montado em `/var/data`.

### 2) Frontend no GitHub Pages
- Edite o arquivo `config.js` na raiz e preencha:
  - `API_BASE: "https://SEU-BACKEND.onrender.com"`
- Faça commit/push da alteração.
- No GitHub: `Settings > Pages` e selecione:
  - `Deploy from a branch`
  - Branch `main` e pasta `/ (root)`

Sem backend online, partes dinâmicas (login, carrinho, pedidos, admin e catálogo via API) não funcionam no Pages.
