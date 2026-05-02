# API Fastify

API REST em Fastify + TypeScript para um fluxo simples de gestao de usuarios,
lojas, vendedores e produtos em estoque.

## O que o projeto faz

- Cadastro de usuarios com perfis `vendedor`, `gestor` e `master`.
- Login com JWT e rotas protegidas por autenticacao/autorizacao.
- Recuperacao e redefinicao de senha.
- Cadastro e consulta de lojas.
- Vinculo de vendedores a lojas.
- Cadastro, listagem, edicao e remocao de produtos por loja.

## Tecnologias

- Node.js 20
- Fastify
- TypeScript
- Prisma ORM
- SQLite
- Docker e Docker Compose

## Como rodar com Docker

```bash
git clone git@github.com:andrepieresan/api_fastify.git
cd api_fastify
docker compose up --build
```

A API fica disponivel em:

```text
http://localhost:3333
```

Teste:

```bash
curl http://localhost:3333/check
```

Resposta esperada:

```json
{ "status": "online" }
```

## Como rodar localmente

Requisitos:

- Node.js 20+
- Yarn

Passos:

```bash
git clone git@github.com:andrepieresan/api_fastify.git
cd api_fastify
cp .env.example .env
yarn install
yarn db:generate
yarn db:migrate
yarn dev
```

o servidor sobe em:

```text
http://localhost:3333
```

## Variaveis de ambiente

Exemplo disponivel em `.env.example`:

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="secret"
PASSWORD_RESET_TOKEN_TTL_MINUTES=30
```

## Scripts uteis

```bash
yarn dev          # roda a API em modo desenvolvimento
yarn check        # valida TypeScript sem gerar build
yarn build        # compila o projeto para dist/
yarn start:prod   # roda a versao compilada
yarn db:generate  # gera o client do Prisma
yarn db:migrate   # aplica/cria migracoes em desenvolvimento
yarn db:deploy    # aplica migracoes em ambiente de deploy
```

## Principais rotas

Rotas publicas:

```text
GET  /
GET  /check
POST /user/store
POST /login
POST /forgot-password
POST /reset-password
```

Rotas protegidas por JWT:

```text
GET    /user/me
GET    /users
GET    /stores
GET    /stores/:storeId
POST   /stores
PATCH  /stores/:storeId
POST   /stores/:storeId/sellers
DELETE /stores/:storeId/sellers/:sellerId
GET    /products
GET    /products/:productId
PATCH  /products/:productId
DELETE /products/:productId
GET    /stores/:storeId/products
POST   /stores/:storeId/products
```

Para usar rotas protegidas, envie o token retornado no login:

```bash
Authorization: Bearer SEU_TOKEN_JWT
```

## Exemplo de uso

Criar usuario:

```bash
curl -X POST http://localhost:3333/user/store \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Gestor Teste",
    "email": "gestor@teste.com",
    "password": "123456",
    "role": "gestor"
  }'
```

Fazer login:

```bash
curl -X POST http://localhost:3333/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "gestor@teste.com",
    "password": "123456"
  }'
```

Com o token retornado, ja e possivel criar lojas, vincular vendedores e
gerenciar produtos.
