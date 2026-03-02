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
