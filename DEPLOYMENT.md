# Deployment and scaling

## Hosted editor versus complete service

The provided hosted edition is a static frontend. PDF editing/export happens locally, so it works without a hosted Node process. It does **not** include a provisioned Gotenberg service. Uploading a non-PDF gives a clear connection error until a conversion backend is configured.

The complete free-software deployment is the included Docker stack. Running it on your own existing machine avoids SDK/API fees. Hosting, storage, domains, electricity and bandwidth may still cost money. Do not assume any cloud vendor provides a permanent free tier suitable for Gotenberg.

## Single-machine deployment

```bash
docker compose --profile full up -d --build
```

Open `http://localhost:8080`. The proxy serves the frontend and `/api` on one origin. The API streams a response into bounded server memory and keeps no output directory. Uploaded originals are short-lived files under `/tmp/uploads`. Gotenberg is on an internal network and the host API port is bound to loopback.

For a public deployment, terminate HTTPS at an ingress you administer, configure `CORS_ORIGINS` for the exact public origin, and set `TRUST_PROXY_HOPS` for the actual path. Preserve network isolation and avoid exposing the raw converter. Configure ingress admission, abuse prevention, request-body/connection limits, monitoring, backups for application configuration, and a container patching process. The public ingress must not allow arbitrary Gotenberg routes.

## Vercel / Netlify frontend

Use the repository root as the build root, install with `npm ci`, build with `npm run build`, and publish `dist`. Set `VITE_API_URL` to the HTTPS origin of your deployed Express service before the build. Configure that exact frontend origin in backend `CORS_ORIGINS`.

Vercel and Netlify host the static frontend. The Gotenberg container and conversion Node service belong on an appropriate container host, not in a short-lived static-site function. Custom CSP settings must include your backend origin in `connect-src` if the API is hosted separately.

## Railway / Render or another container host

Deploy `backend/Dockerfile` using the repository root as build context. Deploy the pinned Gotenberg image separately, on private networking; copy the Compose security flags and resource limits. Set `GOTENBERG_URL` to that service's private HTTP origin. Use ephemeral writable storage for `UPLOAD_DIR`; no persistent volume is required. Health endpoint: `/api/health`; readiness endpoint: `/api/ready`.

Check each provider's current pricing, CPU/RAM allowances, service sleep policy, private networking support, and maximum request duration before deploying. This project does not promise that multi-container conversion is free on either provider.

## Scaling path

1. **Current baseline:** one stateless API process, up to two admitted uploads/conversions, 30 requests per IP per 15 minutes, bounded temporary disk and response sizes. Overflow receives 503 plus Retry-After.
2. **More API replicas:** place API instances behind an ingress and move rate limiting to a shared store such as Redis. The current in-memory limits apply separately to each instance and must not be mistaken for global quotas.
3. **More converters:** use a pool of Gotenberg instances. LibreOffice is sequential within each instance; adding API threads alone does not increase Office throughput. Route requests through a health-aware pool and match admitted jobs to converter capacity.
4. **Long-running or high-volume work:** introduce a bounded job queue, authenticated job ownership, retry policy, output TTL, and S3/MinIO objects with short-lived signed URLs. These are extensions, not included runtime capabilities.
5. **Browser performance:** keep one full-resolution page rendered and bound thumbnails. PDF.js rendering and pdf-lib export run in separate Web Workers. Export uses a copied transferable buffer to preserve the original and keep the UI responsive, with a 90-second timeout. For very large files, consider an authenticated server job after measuring browser memory.

Benchmark your document corpus and concurrent workload before setting an SLA. Large or adversarial Office files require more CPU and RAM than a static site. No throughput or production-readiness certification is implied by the included tests.
