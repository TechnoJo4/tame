set dotenv-load

run:
    deno run -A ./packages/core/index.ts

gen-schemas:
    deno run -A ./packages/core/scripts/gen-plugin-schemas.ts
