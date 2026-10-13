# Deploying the Audion API to Cloud Run

You run these steps. Nothing in this repository creates cloud resources, changes IAM or billing, or starts tuning
jobs, and the commands below are for you to read and run yourself. Replace the `PLACEHOLDERS`.

## 0. What the service needs

| Setting       | Value                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime       | Node 20 container (`apps/api/Dockerfile`), non-root, listens on `$PORT`                                                                          |
| Google access | The Cloud Run **service account** through Application Default Credentials. Never create or download a key                                        |
| Env           | `MOCK=0`, `GCP_PROJECT`, `RECOGNIZE_MODEL`, `RECOGNIZE_LOCATION`, `COMPOSE_MODEL`, `COMPOSE_LOCATION`, `CONFIDENCE_THRESHOLD`, `ALLOWED_ORIGINS` |
| Secret        | `JWT_SECRET` from Secret Manager (the API refuses to start in live mode without it)                                                              |

The API refuses to start with `MOCK=0` if `GCP_PROJECT`, `JWT_SECRET` or `ALLOWED_ORIGINS` is missing, and warns if
`ALLOWED_ORIGINS=*`.

Models (all configuration, no code change):

```
# Base model, global endpoint
RECOGNIZE_MODEL=gemini-3.5-flash
RECOGNIZE_LOCATION=global
# Tuned model: its endpoint resource name, in the region it was tuned in
RECOGNIZE_MODEL=projects/<project-number>/locations/us-central1/endpoints/<endpoint-id>
RECOGNIZE_LOCATION=us-central1
COMPOSE_MODEL=gemini-3.5-flash
COMPOSE_LOCATION=global
```

Google's tuning docs show a tuned model being called with `model` set to the tuned endpoint
(`projects/…/locations/us-central1/endpoints/…`), which is what the client does. They do not say whether tuned
models return logprobs. If they do not, the API still works and returns `confidence: null`; the extension then treats
every answer as confirmed (no "Did you mean…?" prompts). That is the honest fallback, not a bug.

## 1. One-time setup (your project)

```bash
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com aiplatform.googleapis.com texttospeech.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
```

Service account with least privilege (these change IAM, so they are yours to approve):

```bash
gcloud iam service-accounts create audion-api --display-name "Audion API"
SA=audion-api@PROJECT_ID.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding PROJECT_ID --member "serviceAccount:$SA" --role roles/aiplatform.user
# Cloud Text-to-Speech only needs its API enabled (above); no extra role should be required. Verify on first call.
```

JWT secret (random, never committed):

```bash
openssl rand -base64 48 | gcloud secrets create audion-jwt-secret --data-file=-
gcloud secrets add-iam-policy-binding audion-jwt-secret \
  --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
```

Image registry:

```bash
gcloud artifacts repositories create audion --repository-format=docker --location=us-central1
```

## 2. Build

From the repo root:

```bash
IMAGE=us-central1-docker.pkg.dev/PROJECT_ID/audion/audion-api:$(git rev-parse --short HEAD)
gcloud builds submit --config apps/api/cloudbuild.yaml --substitutions _IMAGE=$IMAGE .
# or locally: docker build -f apps/api/Dockerfile -t $IMAGE . && docker push $IMAGE
```

## 3. Deploy

`ALLOWED_ORIGINS` must be the extension's origin: `chrome-extension://<extension-id>` (find the ID on
`chrome://extensions`, or after publishing; see `docs/extension-id.md` for a stable ID in development). Put env vars in a file so the commas and colons survive:

```yaml
# env.yaml (do not commit if it holds anything you consider sensitive; it holds no secrets)
MOCK: '0'
GCP_PROJECT: PROJECT_ID
RECOGNIZE_MODEL: gemini-3.5-flash
RECOGNIZE_LOCATION: global
COMPOSE_MODEL: gemini-3.5-flash
COMPOSE_LOCATION: global
CONFIDENCE_THRESHOLD: '0.5'
ALLOWED_ORIGINS: chrome-extension://EXTENSION_ID
# Cloud Run's front end appends the real client IP to X-Forwarded-For; trust exactly that one hop so the per-IP
# rate limits apply per user, not to Google's proxy as a whole.
TRUST_PROXY_HOPS: '1'
```

```bash
gcloud run deploy audion-api \
  --image $IMAGE --region us-central1 \
  --service-account $SA \
  --env-vars-file env.yaml \
  --set-secrets JWT_SECRET=audion-jwt-secret:latest \
  --allow-unauthenticated \
  --max-instances 3 --concurrency 20 --memory 512Mi --cpu 1 --timeout 60
```

`--allow-unauthenticated` grants public invoker access (an IAM change, your call). It is needed because the
extension cannot present a Google identity; the API's own protection is the 15-minute signed session token, the
origin allow-list, request size limits, and rate limits. Be aware of what that means:

- Anyone who finds the URL can request a session token and then call the model, which costs money. The limits are
  per install ID (60 requests/min) and per IP (120/min, 10 sessions/min), held **in memory per instance**, so the
  real ceiling is `max-instances × limit`. Keep `--max-instances` small, set a budget alert, and consider Cloud Armor
  or API Gateway before a public launch.
- The origin check blocks other websites in browsers, not scripts. It is not authentication.

## 4. Point the extension at it

```bash
VITE_API_URL=https://audion-api-XXXX-uc.a.run.app pnpm --filter @audion/extension build
```

The URL becomes the extension's only host permission and only `connect-src`.

## 5. Check it

```bash
curl https://SERVICE_URL/healthz        # {"ok":true,"mode":"live","confidenceThreshold":0.5}
```

Then, with a folder of your own labelled clips (never commit them):

```bash
pnpm --filter @audion/eval eval --manifest test.jsonl --clips ./clips --api https://SERVICE_URL
```

The report prints API mode first and warns loudly if it is `mock`. First live run, look for:

1. **Model ID.** `gemini-3.5-flash` was taken from your brief. I could not confirm it in Google's official docs,
   so if the first call returns "model not found", fix `RECOGNIZE_MODEL` / `COMPOSE_MODEL` (and the location).
2. **Logprobs.** In the report, "Confidence reported on N/N". If N is 0 the model returned no logprobs.
3. **Thinking.** If many answers come back `unknown` with long latency, thinking tokens may be using the output
   budget (the code asks for 2048). Raise it in `services/live/recognizer.ts` if so.
4. **Text-to-Speech.** `POST /v1/speak` returns `audio/mpeg`. If it returns `MODEL_UNAVAILABLE`, check the API is
   enabled and the voice names in `packages/shared/src/voices.ts` exist for your project.

## 6. Switching to the tuned model (M8)

```bash
gcloud run services update audion-api --region us-central1 \
  --update-env-vars RECOGNIZE_MODEL=projects/NUMBER/locations/us-central1/endpoints/ID,RECOGNIZE_LOCATION=us-central1
```

Run the eval again and compare with the baseline (26.2%). Use the threshold sweep at the end of the report to
choose `CONFIDENCE_THRESHOLD`, then update that variable the same way.

## Privacy checks

- The API never writes clips anywhere and never logs request bodies, clip bytes, sentences or the Authorization
  header (automated tests enforce this). Cloud Run's own request log records the URL and status, not bodies.
- Do not enable request/response body logging on any load balancer in front of the service.
- Do not add a Cloud Storage bucket to this service.
