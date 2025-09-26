# Cloudflare Workers OpenAPI 3.1

This is a Cloudflare Worker with OpenAPI 3.1 using [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

This is an example project made to be used as a quick start into building OpenAPI compliant Workers that generates the
`openapi.json` schema automatically from code and validates the incoming request to the defined parameters or request body.

## Get started

1. Sign up for [Cloudflare Workers](https://workers.dev). The free tier is more than enough for most use cases.
2. Clone this project and install dependencies with `npm install`
3. Run `wrangler login` to login to your Cloudflare account in wrangler
4. Run `wrangler deploy` to publish the API to Cloudflare Workers

## Project structure

1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. For more information read the [chanfana documentation](https://chanfana.pages.dev/) and [Hono documentation](https://hono.dev/docs).

## Development

1. Run `wrangler dev` to start a local instance of the API.
2. Open `http://localhost:8787/` in your browser to see the Swagger interface where you can try the endpoints.
3. Changes made in the `src/` folder will automatically trigger the server to reload, you only need to refresh the Swagger interface.

---

## 🔐 JWT RS256 & JWKS

O serviço suporta emissão de tokens JWT via RS256 (preferido) com fallback para HS256 se chaves RSA não estiverem configuradas.

### Variáveis de Ambiente
| Variável | Descrição |
|----------|-----------|
| `SITE_DNS` | Usado como `iss` e `aud` nos tokens. |
| `JWT_SECRET` | Segredo legado HS256 (fallback). |
| `JWT_PRIVATE_KEY_PEM` | Chave privada PKCS8 (BEGIN PRIVATE KEY) para RS256. |
| `JWT_PUBLIC_KEY_PEM` | Chave pública SPKI (BEGIN PUBLIC KEY) correspondente. |
| `JWT_JWKS_KID` | Identificador (kid) exposto no JWKS (default `k1`). |
| `JWT_EXPIRATION_SEC` | Expiração do access token (ex: 3600). |
| `REFRESH_TOKEN_EXPIRATION_DAYS` | Expiração do refresh token (ex: 30). |

### Endpoint JWKS
`GET /auth/.well-known/jwks.json` retorna um documento contendo (`kty`, `alg`, `kid`, `x5c`, `n`, `e`) para bibliotecas compatíveis.

### Rotação de Chaves (Sugerido)
1. Gerar novo par (kid k2).
2. Publicar JWKS com k1 + k2.
3. Passar a assinar novos tokens com k2.
4. Após expirar tokens k1, remover k1 do JWKS.

### Geração de Chaves (Exemplo)
```bash
openssl genrsa -out private.pem 2048
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private.pem -out private_pkcs8.pem
openssl rsa -in private.pem -pubout -out public.pem
```
Use `private_pkcs8.pem` em `JWT_PRIVATE_KEY_PEM` e `public.pem` em `JWT_PUBLIC_KEY_PEM`.

### Claims Emitidos
`sub`, `email`, `role`, `full_name`, `phone`, `birth_date`, `iss`, `aud`, `exp`, `kid` (se RS256), `jti`.

### Revogação de Access Tokens
- Tabela `revoked_jti` controla JWTs inválidos antes da expiração natural.
- Fluxos que adicionam revogação: logout, troca de senha.
- Verificação centralizada em `service/tokenVerify.ts` rejeita tokens com `jti` revogado.

### Segurança Complementar
- Soft lock + backoff progressivo em tentativas inválidas.
- Jitter para mitigar análise de tempo.
- Sessões de refresh rotacionadas.
- Invalidação seletiva de cache de perfil (`/auth/me`).

---
