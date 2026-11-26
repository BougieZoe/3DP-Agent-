---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 60511e479f736a9399334d56570e10ac_1bed2c6ce95211f1a20652540072b1e8
    ReservedCode1: 57d7jN8iqvCC3xTYE7tLYj3mog/mjao+EN+08ORtXuPWHVkuU8cMYU370iI9mRETzgEHq+QivV0fsPPG50v9Qg4EK1xTNjPho2Q6WVqz9tEkqxPmsoreO/9wfqqYCRROh3gGn0vIHentwtCpBlu7ZOUjek25Rqao31P78iMiZ1ghXOxrayE/wq6Nsw0=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 60511e479f736a9399334d56570e10ac_1bed2c6ce95211f1a20652540072b1e8
    ReservedCode2: 57d7jN8iqvCC3xTYE7tLYj3mog/mjao+EN+08ORtXuPWHVkuU8cMYU370iI9mRETzgEHq+QivV0fsPPG50v9Qg4EK1xTNjPho2Q6WVqz9tEkqxPmsoreO/9wfqqYCRROh3gGn0vIHentwtCpBlu7ZOUjek25Rqao31P78iMiZ1ghXOxrayE/wq6Nsw0=
---

# 3DP Agent Capability Open Standard — Contract v0.1

> **Positioning.** This is not "a feature we use internally". It is a capability that other
> companies can **rent, integrate, or embed**. The first principle is borrowed from how AWS,
> Azure, GCP and Alibaba Cloud were built: **the external contract exists before the internal
> implementation**. Every capability in this repo is treated as a standalone product from its
> very first line of code.

Status: `v0.1` — draft, pre-release. Nothing in this document is externally published yet, so
breaking changes are still allowed. Once `v1` is published, see §1.7.

Scope of this revision: **Photo-to-CAD** is the first capability used to prove the model end to
end. The rules apply to every capability added afterwards.

---

## 1. The six hard rules and what they mean here

| # | Cloud-vendor principle | Concrete meaning in 3DP Agent | Anti-pattern to avoid |
|---|---|---|---|
| 1 | API-first; control plane / data plane separation | The reconstruction capability exposes exactly one contract entry point. The control plane (submit, status, quota, billing) is decoupled from the data plane (which machine actually runs Meshroom). | Frontend calling a local script directly; UI hard-coupled to one engine. |
| 2 | Long-running task model (submit → poll / webhook) | Photo-to-CAD is inherently a minutes-long task. It must be modelled as a Job with event callbacks — never a synchronous blocking request. | A single `POST` that hangs for 90 seconds waiting for a result. |
| 3 | Multi-tenancy; usage record is the billing unit | Every request carries `tenant_id` / `workspace_id`. Every reconstruction emits one usage record (engine, wall time, image count, output bytes). | Logs only, no billable fact. |
| 4 | Standard protocols, no invented private protocols | OpenAPI 3.1 describes the contract; REST + JSON; events follow CloudEvents 1.0 semantics; auth uses OAuth2 / OIDC token exchange. | A bespoke interface only callable by our own SDK. |
| 5 | Embeddable and white-labellable | Two embedding forms: Web Component and iframe. Theme and language are injected by the host. Auth goes through token exchange, never a shared cookie. | Customers can only jump to a full-page redirect of our site. |
| 6 | Data sovereignty and portability | Storage behind an S3-compatible abstraction. All outputs in open formats (STEP / STL / 3MF / GLB). Customers can take away every intermediate and result. | Proprietary format lock-in; customer data cannot leave. |

### 1.7 Engineering discipline: **compatible means committed**

Once `v1` is published externally:

- A breaking change is **only** allowed in a new major version (`v2`). `v1` keeps working.
- `v1` is retained for **at least 12 months** after `v2` ships.
- Deprecation requires advance notice (a `Deprecation` / `Sunset` header plus a changelog entry).
- Additive changes are allowed in-place, but fields are only ever **added** — never removed,
  never retyped, never repurposed. Consumers must ignore unknown fields, and we must never
  depend on consumers failing on unknown fields.

This rule is repeated in `AGENTS.md` because it is a **commitment**, not a preference: an agent
that "cleans up" a published field name silently breaks customers.

---

## 2. v1 contract draft — Photo-to-CAD

### 2.1 Submit a reconstruction job

```
POST /v1/reconstructions
Authorization: Bearer <oidc-token>
Idempotency-Key: <client-generated-uuid>
Content-Type: application/json

{
  "tenant_id": "local",
  "workspace_id": "ws_123",
  "input": {
    "images": [
      { "asset_id": "ast_001", "role": "overview" },
      { "asset_id": "ast_002", "role": "detail" }
    ],
    "scale_reference": { "kind": "calibration_board", "known_mm": 50 }
  },
  "output": { "formats": ["step", "stl", "glb"], "units": "mm" },
  "engine_hint": "meshroom",
  "webhook_url": "https://customer.example/hooks/3dp"
}

→ 202 Accepted
{ "job_id": "job_9f3", "status": "queued", "created_at": "2026-11-26T10:00:00Z" }
```

- `tenant_id` / `workspace_id` are optional on the wire; when absent the server fills them with
  `local`. They are never `null` in stored records.
- `engine_hint` is advisory only; the server may ignore it.
- Replaying the same `Idempotency-Key` returns the original job instead of starting a second
  reconstruction.

### 2.2 Poll a job

```
GET /v1/reconstructions/job_9f3
→ 200

{
  "job_id": "job_9f3",
  "status": "running",
  "progress": { "stage": "dense_reconstruction", "percent": 62 },
  "engine": { "provider": "meshroom", "version": "2023.3.0" },
  "outputs": [],
  "usage": { "gpu_seconds": 84, "images": 12 }
}
```

`status` ∈ `queued | running | succeeded | failed | cancelled`.

#### 2.2.1 Outputs are open formats; STEP is derived, not emitted

Photogrammetry engines produce meshes (STL/GLB/OBJ/3MF). STEP is B-rep, so it can only be
*produced by conversion*, and conversion needs a CAD kernel that may not exist on the host. The
capability therefore separates the two kinds of output:

- **Engine outputs** — whatever the provider can emit; discoverable via `outputs` on
  `GET /v1/capabilities/reconstruction`.
- **Derived outputs** — `step`, advertised under `derived_outputs.step` with its availability
  and, when unavailable, the reason. A caller can decide *before* submitting whether to ask.

If STEP was requested and cannot be produced:

| When | Response |
|---|---|
| Kernel unavailable (known at submit) | `503 STEP_EXPORT_UNAVAILABLE`, no job created, nothing billable |
| Conversion fails after the engine finished | job `failed` with `STEP_EXPORT_FAILED`; the mesh outputs stay on the job and remain downloadable |

The second row is deliberate: reporting `succeeded` while the requested manufacturable format is
missing would be exactly the kind of comfortable lie this capability must never tell. Nothing
that was already produced is discarded.

### 2.3 Events (CloudEvents 1.0 semantics)

```json
{
  "specversion": "1.0",
  "type": "io.3dp.reconstruction.succeeded.v1",
  "source": "urn:3dp:capability:photo-to-cad",
  "id": "evt_77",
  "subject": "job_9f3",
  "data": {
    "outputs": [{ "format": "step", "asset_id": "ast_900" }],
    "usage": { "gpu_seconds": 131 }
  }
}
```

Event types always carry a `.v1` suffix. New fields may only be appended in a
backward-compatible way. `id` is stable per terminal transition, so a consumer that receives the
same event twice can drop the duplicate.

Delivery semantics in v0.1, stated precisely because they are easy to over-promise:

- **One attempt per terminal transition.** `webhook_url` is accepted at submit, and the event is
  posted once when the job first reaches `succeeded` / `failed` / `cancelled`. Repeat polls do
  not re-deliver.
- **No automatic retry.** The outcome is recorded on the job as
  `webhook: { configured, last_delivery }`, and `last_delivery.status` is the honest answer.
  Durability belongs to the caller: polling `GET /v1/reconstructions/:job_id` is idempotent by
  construction, so a missed callback never loses the result.
- **A failed callback never fails the job.** The reconstruction did succeed; only the
  notification did not.
- **Signed, optionally.** `RECON_WEBHOOK_SECRET` enables an HMAC-SHA256 `x-3dp-signature`
  header computed over the raw body, so the receiver can reject forged events.
- **The URL is a bearer secret.** `webhook_url` is never echoed back by the API; only
  `webhook.configured` and the delivery record are visible.

### 2.4 Embedding

- `<tdp-workspace tenant="..." token="...">` Web Component, or an iframe plus a `postMessage`
  channel.
- The host enterprise signs short-lived tokens with its own IdP; we perform token exchange and
  share no cookies.
- Theme (brand colour, font) and language (the existing nine-locale i18n catalogue) are injected
  by the host.

---

## 3. Engine adapter layer (Meshroom is not the architecture)

```ts
export interface ReconstructionProvider {
  readonly id: string;
  readonly version: string;
  capabilities(): ProviderCapabilities;
  submit(job: ReconstructionJob, ctx: JobContext): Promise<{ providerJobId: string }>;
  status(providerJobId: string): Promise<ProviderStatus>;
  cancel(providerJobId: string): Promise<void>;
  collect(providerJobId: string): Promise<ReconstructionOutput[]>;
}
```

- `meshroom` (AliceVision, MIT/BSD-family) is **one implementation**, run as a separate process.
- `apple` (Object Capture, macOS 12+) is a second implementation, also a separate process. It was
  added because Meshroom stopped shipping a macOS build and COLMAP's dense stereo needs CUDA, so
  on Apple silicon neither older option could actually turn photos into a mesh. Swapping it in
  changed no request, no response and no frontend code — which is the whole point of this layer.
- `colmap` (BSD-3) remains for CUDA hosts. Where its build has no GPU support it reports itself
  unavailable rather than accepting work it would abort halfway through.
- `scanruler` (occt-wasm) is another candidate.
- Changing the engine changes no external contract and no frontend code.

**Availability is measured, never assumed.** Every provider answers `GET /v1/capabilities/reconstruction`
from what it can verify on the host — binary present, toolchain present, GPU support present — and
reports `available: false` with a machine-readable reason otherwise. A missing engine is a 503
`ENGINE_NOT_AVAILABLE`, never a fabricated job, progress bar or output file.

**Licence boundary.** The contract layer contains no AGPL code. AGPL-licensed engines may only
be reached across a process boundary (CLI or HTTP) as an independent provider, so the licence
cannot propagate into the main product.

**Data-plane separability.** `RECON_PROVIDER` selects the implementation at boot. A local
provider runs the engine on this machine; a remote provider forwards the same job payload to an
external service. Because the job payload is already standard, moving the data plane off-box
requires no contract change. This machine defaults to `apple` on macOS (the only engine here that
can actually produce a mesh) and to `meshroom` elsewhere; `RECON_PROVIDER=colmap` remains
selectable for CUDA hosts. A platform default is a boot-time choice, not a silent fallback: the
selected engine still reports its own availability truthfully, and an unavailable engine refuses
the job with `ENGINE_NOT_AVAILABLE`.

---

## 4. Do now vs. deliberately later

**Do now — cheap now, impossible to retrofit later:**

1. Job model with versioned event type names (`*.v1`).
2. `tenant_id` / `workspace_id` present in every request context (defaulting to `local`).
3. Usage record persisted, even if it is only JSONL today.
4. Provider interface abstraction, even with a single Meshroom implementation.
5. `openapi.v1.yaml` kept in-repo and validated in CI.

**Explicitly later — placeholder in the contract only, no implementation:**

- Real multi-tenant isolation, quota limiting, billing integration.
- Cloud object storage, cross-region replication.
- White-label Web Component and IdP token exchange.

Recording a placeholder here is not permission to fake the capability. An endpoint that returns
a stub success is worse than an endpoint that is honestly absent.

---

## 5. Acceptance checklist

- [ ] `openapi.v1.yaml` lints clean and every schema carries an `example`.
- [ ] Contract tests: every provider implementation passes the same suite.
- [ ] A request without `tenant_id` defaults to `local` and never 500s.
- [ ] A replayed `Idempotency-Key` does not start a second reconstruction.
- [ ] All three output formats (STEP / STL / GLB) are downloadable without logging into our UI.
- [ ] Event redelivery is idempotent (same `id` processed once).
- [ ] Missing engine binary produces an explicit, machine-readable capability error — never a
      fabricated success.

---

## 6. Revision history

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-26 | Initial draft. Photo-to-CAD as first capability; six hard rules; provider abstraction; tenant field reservation. |
| v0.2 | 2026-11-26 | Added: STEP as a derived output with its own availability channel and two refusal paths; webhook delivery semantics (one attempt, no retry, signed, URL never echoed); `derived_outputs` on the capability descriptor. Additive only — no v1 field changed meaning. |
*（内容由AI生成，仅供参考）*
