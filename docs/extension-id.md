# A stable extension ID for development

An unpacked extension gets a different ID on every machine, which matters because the API only accepts requests
from its own extension origin (`ALLOWED_ORIGINS=chrome-extension://<id>`). To pin the ID for development:

```bash
# 1. Make a key pair. The PRIVATE key stays on your machine (*.pem is git-ignored; never commit it).
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out audion-dev-key.pem

# 2. The public half, as one line of base64:
openssl rsa -in audion-dev-key.pem -pubout -outform DER | openssl base64 -A

# 3. Build with it:
EXTENSION_KEY='<that base64 line>' pnpm --filter @audion/extension build
```

Chrome derives the ID from the public key, so every build with the same key has the same ID. Read it on
`chrome://extensions`, then put it in `ALLOWED_ORIGINS`.

Do **not** set `EXTENSION_KEY` for a Chrome Web Store upload: the store assigns the published ID itself, and the build check
(`pnpm --filter @audion/extension check-build`) fails a release build that contains a `key`. When Audion is
published, switch `ALLOWED_ORIGINS` to the store ID.
