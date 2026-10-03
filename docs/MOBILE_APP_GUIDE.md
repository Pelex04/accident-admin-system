# Mobile app connection guide

For the developer of the Android app. This replaces the old way of connecting (admin email and password inside the app).

## Read this first

1. **The app never needs an admin email or password. Remove those fields.**
2. The app needs only two values: the **server address** and a **device key**.
3. Each vehicle has its own device key. An admin creates it in the dashboard (steps in section 2).
4. Send the key on every request in the header `X-Device-Key`.
5. The SMS alert flow stays exactly as it is today. Calls to this server are a **best effort extra layer**. Never wait for the network before sending the SMS, and never let a failed call stop it.

What a device key can do: report crashes for its own vehicle, update those reports, check in (heartbeat), and read its own vehicle's contacts. It cannot read or change anything else, and it cannot sign in to the dashboard. If a phone is lost, an admin revokes or regenerates that one key and nothing else is affected.

## 1. Why the old way was a problem

Signing in as an admin from the app meant every phone carried a login with full control of the system. Admin logins also expire after 12 hours, force a password change on first use, and are rate limited, which is why the app kept failing to connect. Device keys fix all of that: they do not expire, there is no password change, and they only work for one vehicle.

## 2. Setup (done by an admin, once per vehicle)

1. Open the dashboard and sign in.
2. Go to **Vehicles**, open the vehicle, and find the **Device access** card.
3. Press **Create device key**.
4. A dialog shows the **server address** and the **device key**. Copy both. The key is shown only once.
5. Enter them in the app (a settings screen with two fields: Server address and Device key).

If the key is lost or leaked, press **Regenerate key** (the old key stops working immediately) or **Revoke key**.

Notes for the developer:
- The server address already ends in `/api`, for example `https://your-server.example.com/api`. Use it as the base for every path below.
- Keys look like `dk_` followed by 43 characters. Trim spaces and line breaks when the admin pastes one.

## 3. Try it in one minute (curl)

Set your two values, then paste the block.

```bash
export BASE="https://your-server.example.com/api"
export KEY="dk_paste_the_key_here"
```

<!-- quicktest:start -->
```bash
# 1. Is the server awake? (no key needed. The first call can take up to a minute on free hosting)
curl -s "$BASE/health"

# 2. Who am I? Returns this vehicle and its contacts
curl -s "$BASE/device/me" -H "X-Device-Key: $KEY"

# 3. Check in (heartbeat). The body can be empty {} or carry the SIM balance text
curl -s -X POST "$BASE/device/heartbeat" -H "X-Device-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"balanceText":"Main balance MWK 900"}'

# 4. Report a crash. clientEventId is an id YOUR app makes up (a UUID)
curl -s -X POST "$BASE/device/crash" -H "X-Device-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"clientEventId":"test-0001","status":"countdown","latitude":-15.7861,"longitude":35.0058}'

# 5. Send the same report again (a retry). You get the original back with "duplicate": true
curl -s -X POST "$BASE/device/crash" -H "X-Device-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"clientEventId":"test-0001","status":"countdown","latitude":-15.7861,"longitude":35.0058}'

# 6. The countdown ended and the SMS went out. Update the report using your own id
curl -s -X PATCH "$BASE/device/crash/test-0001" -H "X-Device-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"status":"alert_sent","notes":"SMS sent to 2 contacts"}'

# 7. A wrong key is refused
curl -s -i "$BASE/device/me" -H "X-Device-Key: dk_wrong" | head -1
```
<!-- quicktest:end -->

Test reports show up in the dashboard like real ones. Ask an admin to set them to a status such as cancelled, or use a test vehicle.

## 4. The rules every call follows

- **HTTPS only.** Android blocks plain http by default, and the server redirects it.
- **Header:** `X-Device-Key: dk_...` (or `Authorization: Device dk_...`) on every `/device/...` call. `/health` needs no key.
- **Body:** JSON with `Content-Type: application/json`. Responses are always JSON.
- **Times:** ISO 8601 in UTC, for example `2026-10-03T10:15:30.123Z`. In Kotlin, `Instant.now().toString()` gives this.
- **Errors:** `{ "error": "readable message", "code": "machine_code" }`.
- **Limits:** about 240 requests per 10 minutes per device. More than enough for normal use.

## 5. Endpoints

### GET /health
No key. Returns `{ "status": "ok", "time": "..." }`. Use it to wake the server before important calls.

### GET /device/me
Returns this vehicle and its contacts, ordered by priority:
```json
{
  "vehicle": { "id": "...", "name": "Truck 1", "status": "active" },
  "contacts": [ { "id": "...", "name": "Dad", "phoneNumber": "+265888333444", "priority": 1 } ],
  "settings": { "recommendedHeartbeatMinutes": 60, "staleAfterMinutes": 720 },
  "serverTime": "2026-10-03T10:15:30.123Z"
}
```
The app keeps its own contact list for sending SMS. Reading contacts here is optional.

### POST /device/heartbeat
Tells the dashboard the device is alive. Body is optional.

| Field | Type | Notes |
| --- | --- | --- |
| `balanceText` | string, up to 500 chars | Raw USSD or carrier text. The server detects "low balance" itself. Leave it out when you have nothing new. A check in without it keeps the last known balance. |

Response: `{ "ok": true, "lowBalance": false, "serverTime": "..." }`

### POST /device/crash
Creates a crash report. Returns **201** for a new report and **200** with `"duplicate": true` when the same `clientEventId` was already received.

| Field | Type | Notes |
| --- | --- | --- |
| `clientEventId` | string, 1 to 64 chars `A-Z a-z 0-9 . _ : -` | **Always send one** (a UUID). It makes retries safe. |
| `status` | `detected`, `countdown`, `cancelled`, `alert_sent`, `alert_failed` | Defaults to `detected`. |
| `latitude`, `longitude` | numbers (numeric strings are accepted) | Send both or neither. |
| `detectedAt` | ISO 8601 time | When the crash happened. Used if it is within the last 30 days, otherwise server time is used. |
| `notes` | string, up to 2000 chars | Optional. |
| `cancelledBy` | string, up to 120 chars | For example `user`. |

Response:
```json
{ "event": { "id": "...", "vehicleId": "...", "detectedAt": "...", "latitude": -15.7861, "longitude": 35.0058,
             "status": "countdown", "cancelledBy": null, "notes": "" },
  "duplicate": false,
  "warnings": [] }
```
A crash report is **never rejected over a bad optional field**. A bad location, time or notes value is dropped and explained in `warnings` (for example `"latitude ignored: must be a number between -90 and 90"`). Log warnings during development, they point to bugs in the app. A wrong `status`, `clientEventId` or request shape returns **400**.

### PATCH /device/crash/{id}
Updates one of this device's own reports. `{id}` can be the server `id` **or your own `clientEventId`**, so the update still works if the create response never arrived. Send only the fields you want to change: `status`, `cancelledBy`, `notes`, `latitude`, `longitude`. Response: `{ "event": {...}, "warnings": [] }`. A report that belongs to another vehicle returns **404**.

### GET /device/crash/{id}
Returns `{ "event": {...} }`, with the same id rules as PATCH.

### GET /device/crashes?limit=20
Returns `{ "events": [...] }`, newest first, up to 50.

## 6. How the app should behave

### Crash flow

```
ACCIDENT SMS arrives from the Arduino
  |
  |-- (1) start the countdown and the SMS flow exactly as today. Do not wait for the network.
  |-- (2) make a UUID, save it with the crash locally, queue:  POST /device/crash {clientEventId, status:"countdown", GPS, detectedAt}
  |
  +-- user cancels      -> queue: PATCH /device/crash/{clientEventId} {status:"cancelled", cancelledBy:"user"}
  +-- SMS sent          -> queue: PATCH /device/crash/{clientEventId} {status:"alert_sent"}
  +-- SMS failed        -> queue: PATCH /device/crash/{clientEventId} {status:"alert_failed"}
```

If GPS is not ready at step 2, send the report without a location and PATCH `latitude` and `longitude` when you get them.

### Offline queue and retries

Mobile data in the field is unreliable, so every call goes through a small persistent queue (a Room table, for example):

- Save the request first, then try to send it. Keep it until you get a **2xx** response.
- Send requests for the same crash **in order**: create, then updates.
- Retry with growing waits: 30 s, 1 min, 2 min, 5 min, 10 min, then every 15 min.
- Because of `clientEventId`, sending the same create twice is harmless.

What to do with each response:

| Response | Meaning | Action |
| --- | --- | --- |
| 200, 201 | Done | Remove from the queue |
| 408, 5xx, timeout, no network | Temporary | Retry later |
| 429 | Too many requests | Wait for the `Retry-After` seconds, then retry |
| 401 `invalid_device_key` | Key wrong, revoked or regenerated | Stop sending, show "Ask the admin for a new device key", keep the queue |
| 400 `invalid_request` | The app sent something invalid | Do not retry. Log the `error` text. It is a bug to fix |
| 404 `not_found` | Unknown report for this vehicle | Do not retry |

### Heartbeat

- Send one about every hour with Android WorkManager (`PeriodicWorkRequest`, minimum interval 15 minutes), and once after boot and when the app opens.
- Include `balanceText` only when you actually read a new balance.
- The dashboard marks a vehicle "no recent check in" after 12 hours of silence, so hourly leaves plenty of margin.

### Slow first request

The server may be asleep (free hosting). The first call after a quiet period can take up to about a minute. Use a long timeout (60 s) for the first call after the app starts, call `GET /health` first if you like, then use normal timeouts (15 to 20 s). Because crash calls are queued and retried, a slow server never loses a report.

## 7. Security rules for the app

- Store the device key in `EncryptedSharedPreferences` or the Android Keystore, not in plain preferences.
- Never write the key to logs, crash reports or screenshots.
- Never hard-code a key in the source. Each vehicle has its own, entered at setup.
- Use HTTPS only. Do not turn on cleartext traffic.
- No admin fields anywhere in the app.
- The server stores only a fingerprint of each key, so a lost key cannot be looked up. An admin creates a new one.

## 8. Kotlin example (OkHttp)

Illustrative, not compiled against your project. Adjust names and error handling to your code.

```kotlin
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit

sealed interface Outcome {
    object Done : Outcome
    data class Retry(val afterSeconds: Long? = null) : Outcome
    data class Drop(val reason: String) : Outcome        // do not retry
    object KeyRejected : Outcome                         // stop and ask for a new key
}

class DeviceApi(private val baseUrl: String, private val deviceKey: () -> String) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)               // use 60 s for the first call after the app starts
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("X-Device-Key", deviceKey().trim())
                    .header("Accept", "application/json")
                    .build()
            )
        }
        .build()

    private fun send(method: String, path: String, body: JSONObject): Outcome {
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .method(method, body.toString().toRequestBody(jsonType))
            .build()
        return try {
            client.newCall(request).execute().use { r ->
                when {
                    r.isSuccessful -> Outcome.Done
                    r.code == 401 -> Outcome.KeyRejected
                    r.code == 429 -> Outcome.Retry(r.header("Retry-After")?.toLongOrNull())
                    r.code == 408 || r.code >= 500 -> Outcome.Retry()
                    else -> Outcome.Drop("HTTP ${r.code}: ${r.body?.string()?.take(300)}")
                }
            }
        } catch (e: IOException) {
            Outcome.Retry()                              // no network, timeout, server asleep
        }
    }

    fun heartbeat(balanceText: String? = null) =
        send("POST", "/device/heartbeat", JSONObject().apply { balanceText?.let { put("balanceText", it) } })

    fun reportCrash(clientEventId: String, lat: Double?, lon: Double?, detectedAt: Instant, status: String = "countdown") =
        send("POST", "/device/crash", JSONObject()
            .put("clientEventId", clientEventId)
            .put("detectedAt", detectedAt.toString())
            .put("status", status)
            .apply { if (lat != null && lon != null) { put("latitude", lat); put("longitude", lon) } })

    fun updateCrash(clientEventId: String, status: String, cancelledBy: String? = null) =
        send("PATCH", "/device/crash/$clientEventId", JSONObject()
            .put("status", status)
            .apply { cancelledBy?.let { put("cancelledBy", it) } })
}
```

Usage: make `val id = UUID.randomUUID().toString()` when the ACCIDENT SMS arrives, store it with the crash, call `reportCrash(id, ...)` from your queue worker, then `updateCrash(id, "cancelled", "user")` or `updateCrash(id, "alert_sent")` as the flow finishes. Keep each queued item until `send` returns `Outcome.Done`.

## 9. Moving from the old admin approach

| Old (admin login) | New (device key) |
| --- | --- |
| `POST /api/auth/login` and storing a token | Removed. Send `X-Device-Key` instead |
| `POST /api/events` with `vehicleId` | `POST /api/device/crash` (no `vehicleId`, add `clientEventId`) |
| `PUT /api/events/{id}` | `PATCH /api/device/crash/{id}` |
| `POST /api/sim/{vehicleId}/heartbeat` | `POST /api/device/heartbeat` (no `vehicleId`) |
| `GET /api/vehicles/{id}/contacts` | `GET /api/device/me` |
| Admin email and password fields | Deleted. One "Device key" field and one "Server address" field |

The old admin calls still exist for the dashboard, but the app should not use them.

## 10. If it will not connect

| What you see | Likely cause | What to do |
| --- | --- | --- |
| First call hangs or times out, later calls work | Server was asleep | Wait up to a minute, call `/health` first, use a 60 s first timeout |
| `401` with code `invalid_device_key` | Typo, extra space, wrong vehicle, or the key was regenerated or revoked | Copy the key again, trim it, check the header name is exactly `X-Device-Key`, ask the admin for a new key |
| `403` with code `password_change_required` | You are still using an admin login | Stop using admin logins. Use a device key |
| `401` after about 12 hours on an admin login | Admin tokens expire | Same: use a device key, which does not expire |
| `404 Route not found` | The server address is missing `/api`, or the path is wrong | The base must end in `/api`. Paths start with `/device/...` |
| `429` | Too many requests or too many wrong keys | Wait for `Retry-After` seconds. Check the app is not looping |
| `CLEARTEXT communication not permitted` | The address starts with `http://` | Use `https://` |
| `400 invalid_request` | The app sent something invalid | Read the `error` text, it names the problem |
| `200` or `201` but `warnings` is not empty | An optional field was dropped | Fix the field. The report was still saved |
| TLS or certificate errors | Phone date and time are wrong, or an old Android version | Fix the clock. Check the HTTPS address in a browser |

## 11. Acceptance checklist

- [ ] No admin email or password field exists anywhere in the app
- [ ] The key is stored encrypted and never logged
- [ ] Heartbeat arrives hourly and appears as "last check in" in the dashboard
- [ ] A crash with data off still sends the SMS, then the report reaches the dashboard once data returns
- [ ] Pulling the network in the middle of a crash and sending the same report twice creates one report
- [ ] Cancel, alert sent and alert failed each update the same report
- [ ] A revoked key produces a clear message in the app, not a crash
- [ ] The first request after a quiet period succeeds despite a slow server

## 12. Asking for help

When you report a problem to the backend owner, send: the vehicle name, the time with time zone, the endpoint, the HTTP status and the `error` and `code` text. **Never send the device key itself.**

A machine readable version of this API is in `docs/openapi-device.yaml`. It can be imported into Postman or used to generate a client.
