set dotenv-load

run:
    deno run -A .\index.ts

gen-schemas:
    deno run -A ./scripts/gen-plugin-schemas.ts
