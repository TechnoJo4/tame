set dotenv-load

run:
    deno run -A ./packages/core/index.ts

gen-schemas:
    deno run -A ./scripts/gen-plugin-schemas.ts

gen-rpc-types:
    deno run -A ./scripts/gen-rpc-types.ts
