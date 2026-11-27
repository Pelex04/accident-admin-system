# Mobile app connection guide

How to connect the Android app to the server. Follow Steps 1 to 4 in order. Everything after that is reference.

## Contents

- [The short version](#the-short-version)
- [Step 1: Get a device key](#step-1-get-a-device-key)
- [Step 2: Test the connection](#step-2-test-the-connection)
- [Step 3: Build the app behaviour](#step-3-build-the-app-behaviour)
- [Step 4: Check your work](#step-4-check-your-work)
- [Endpoint reference](#endpoint-reference)
- [Kotlin example](#kotlin-example)
- [Moving from admin login](#moving-from-admin-login)
- [Troubleshooting](#troubleshooting)

## The short version

The app needs two settings:

| Setting | Example |
| --- | --- |
| Server address | `https://your-server.example.com/api` |
| Device key | `dk_` followed by 43 characters |

Three rules:

1. **SMS comes first.** Never wait for the server before sending an SMS, and never let a failed server call stop it.
2. **No admin login in the app.** Remove any email and password fields.
3. **Send the key on every `/device/...` request** in the `X-Device-Key` header.

A device key belongs to one vehicle. It can report and update that vehicle's crashes, send check ins and read that vehicle's contacts. It cannot do anything else. It does not expire.

## Step 1: Get a device key

An admin does this once for each vehicle.

1. Sign in to the dashboard.
2. Open **Vehicles**, then open the vehicle.
3. In the **Device access** card, press **Create device key**.
4. Copy the **server address** and the **device key**. The key is shown only once.
5. Enter both on the app's settings screen. Trim spaces and line breaks from pasted values.

If a key is lost or leaked, press **Regenerate key** or **Revoke key**. The old key stops working immediately.

## Step 2: Test the connection

Do this from a computer before writing any app code. Set your two values:

```bash
export BASE="https://your-server.example.com/api"
export KEY="dk_paste_the_key_here"
```

Then run the commands.

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
  -d '{"clientEventId":"test-0001","status":"countdown","ref":"K7Q2","latitude":-15.7861,"longitude":35.0058}'

# 5. Send the same report again (a retry). You get the original back with "duplicate": true
curl -s -X POST "$BASE/device/crash" -H "X-Device-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"clientEventId":"test-0001","status":"countdown","ref":"K7Q2","latitude":-15.7861,"longitude":35.0058}'

# 6. The countdown ended and the SMS went out. Update the report using your own id
curl -s -X PATCH "$BASE/device/crash/test-0001" -H "X-Device-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"status":"alert_sent","deliveries":[{"role":"dispatcher","phoneNumber":"+265999000111","status":"delivered"}]}'

# 7. A wrong key is refused
curl -s -i "$BASE/device/me" -H "X-Device-Key: dk_wrong" | head -1
```
<!-- quicktest:end -->

If command 2 returns your vehicle name, the connection works. Test reports appear in the dashboard and on the live board like real ones, so use a test vehicle and tell the dispatcher before testing.

## Step 3: Build the app behaviour

### When a crash happens

1. The accident SMS arrives from the Arduino.
2. Start the countdown immediately.
3. Make two values and save them with the crash:
   - `clientEventId`: a UUID. It stops retries from creating duplicate reports.
   - `ref`: 4 to 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, 1, I or O). It matches an SMS to its row on the live board.
4. Queue `POST /device/crash` with `clientEventId`, `ref`, `detectedAt`, location and `"status": "countdown"`.
5. Queue one update when the outcome is known:

| What happened | Send with `PATCH /device/crash/{clientEventId}` |
| --- | --- |
| User cancelled | `{"status":"cancelled","cancelledBy":"user"}` |
| SMS sent | `{"status":"alert_sent","deliveries":[...]}` |
| SMS failed | `{"status":"alert_failed","deliveries":[...]}` |

If there is no GPS fix yet, create the report without a location and send `latitude` and `longitude` in a later update.

### Who receives the SMS

Each contact has a `role`. Fetch contacts with `GET /device/me` while online and save them on the phone, so they are available during a crash with no data.

| Role | Message |
| --- | --- |
| `dispatcher` | Short and factual, with the `ref` and a directions link: `https://google.com/maps/dir//LAT,LNG` |
| `next_of_kin` | Personal, with the `ref` and a map pin link |

### Report SMS delivery

Add `deliveries` to an update to show who was reached. Send another update when a result changes.

```json
{
  "deliveries": [
    { "role": "dispatcher",  "phoneNumber": "+265999000111", "status": "delivered" },
    { "role": "next_of_kin", "phoneNumber": "+265888111222", "status": "failed" }
  ]
}
```

`status` is `pending`, `sent`, `delivered` or `failed`. Send at most 20 entries. A late `sent` does not replace `delivered`.

### Offline queue

Mobile data is unreliable, so put every crash call in a saved queue (for example a Room table).

- Save the request first, then send it.
- Keep it until the server answers with 200 or 201.
- Keep the order for each crash: create first, then updates.
- Retry after 30 s, 1 min, 2 min, 5 min, 10 min, then every 15 min.

| Response | What to do |
| --- | --- |
| 200, 201 | Done. Remove it from the queue |
| No network, timeout, 408, 5xx | Retry later |
| 429 | Wait for the number of seconds in `Retry-After`, then retry |
| 401 | Stop sending, keep the queue, show "Ask the admin for a new device key" |
| 400, 404 | Do not retry. Log the `error` text and fix the bug |

### Check in (heartbeat)

- Call `POST /device/heartbeat` about once an hour with WorkManager, after the phone restarts and when the app opens.
- Include `balanceText` only when you have a new balance reading.
- After 12 hours of silence the dashboard shows "no recent check in".

### Slow first request

On free hosting the server sleeps when idle, and the first request can take about a minute. Use a 60 second timeout for the first call after the app starts, then 15 to 20 seconds.

### Keep the key safe

- Store it in `EncryptedSharedPreferences` or protect it with the Android Keystore.
- Never write it to logs, crash reports or screenshots.
- Never put a key in the source code.
- Use `https://` only.

## Step 4: Check your work

- [ ] The app has no admin email or password field
- [ ] The key is stored encrypted and never logged
- [ ] The vehicle's **Last check in** updates in the dashboard every hour
- [ ] With data off, the SMS still sends, and the report arrives when data returns
- [ ] Sending the same report twice creates only one report
- [ ] Cancelled, sent and failed each update the same report
- [ ] The `ref` in the SMS matches the one on the live board
- [ ] SMS delivery results appear on the live board
- [ ] A revoked key shows a clear message and the app keeps running
- [ ] The first request after a long quiet period succeeds

## Endpoint reference

All paths start from the server address, which already ends in `/api`. Send JSON with `Content-Type: application/json`. Times are ISO 8601 in UTC, for example `2026-10-03T10:15:30Z` (Kotlin: `Instant.now().toString()`). Errors look like `{"error":"readable message","code":"machine_code"}`. Each device may make about 240 requests every 10 minutes.

| Request | Purpose |
| --- | --- |
| `GET /health` | Check the server is awake. No key needed |
| `GET /device/me` | This vehicle and its contacts |
| `POST /device/heartbeat` | Check in |
| `POST /device/crash` | Create a crash report |
| `PATCH /device/crash/{id}` | Update a report |
| `GET /device/crash/{id}` | Read one report |
| `GET /device/crashes?limit=20` | Recent reports, newest first, up to 50 |

`{id}` is either your `clientEventId` or the server `id`. A device can only see its own vehicle's reports.

### GET /device/me

```json
{
  "vehicle": { "id": "...", "name": "Truck 1", "status": "active" },
  "contacts": [
    { "id": "...", "name": "Dad", "phoneNumber": "+265888333444", "priority": 1, "role": "next_of_kin" }
  ],
  "settings": { "recommendedHeartbeatMinutes": 60, "staleAfterMinutes": 720 },
  "serverTime": "2026-10-03T10:15:30.123Z"
}
```

### POST /device/heartbeat

Send `{}` or `{"balanceText":"..."}`. `balanceText` is the raw carrier message, up to 500 characters. The server detects a low balance itself.

Response: `{"ok":true,"lowBalance":false,"serverTime":"..."}`

### Crash report fields

| Field | Create | Update | Rules |
| --- | --- | --- | --- |
| `clientEventId` | Yes | No | 1 to 64 characters: letters, digits `. _ : -`. Always send it |
| `ref` | Yes | No | 4 to 6 characters, see Step 3. The server makes one if missing |
| `status` | Yes | Yes | `detected` (default), `countdown`, `cancelled`, `alert_sent`, `alert_failed` |
| `detectedAt` | Yes | No | Within the last 30 days, otherwise server time is used |
| `latitude`, `longitude` | Yes | Yes | Numbers. Send both or neither |
| `notes` | Yes | Yes | Up to 2000 characters |
| `cancelledBy` | Yes | Yes | Up to 120 characters, for example `user` |
| `deliveries` | No | Yes | See Report SMS delivery |

Creating returns **201**. Sending the same `clientEventId` again returns **200** with `"duplicate": true` and the report as it is now. It does not change the report.

```json
{
  "event": { "id": "...", "ref": "K7Q2", "status": "countdown", "latitude": -15.7861, "longitude": 35.0058 },
  "duplicate": false,
  "warnings": []
}
```

The response is shortened here. An update returns `event` and `warnings`.

A wrong `status`, `clientEventId`, `cancelledBy` or request shape returns **400**. A bad location, time, `ref`, `notes` or delivery entry does not: the report is saved and the problem is listed in `warnings`. Log warnings while developing.

## Kotlin example

This uses OkHttp. It has not been compiled against your project, so adjust it to fit.

```kotlin
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
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

    fun reportCrash(clientEventId: String, lat: Double?, lon: Double?, detectedAt: Instant, ref: String, status: String = "countdown") =
        send("POST", "/device/crash", JSONObject()
            .put("clientEventId", clientEventId)
            .put("detectedAt", detectedAt.toString())
            .put("status", status)
            .put("ref", ref)
            .apply { if (lat != null && lon != null) { put("latitude", lat); put("longitude", lon) } })

    fun updateCrash(clientEventId: String, status: String, cancelledBy: String? = null, deliveries: JSONArray? = null) =
        send("PATCH", "/device/crash/$clientEventId", JSONObject()
            .put("status", status)
            .apply {
                cancelledBy?.let { put("cancelledBy", it) }
                deliveries?.let { put("deliveries", it) }
            })
}
```

Call `reportCrash(...)` and `updateCrash(...)` from your queue worker, and keep each item queued until the result is `Outcome.Done`.

## Moving from admin login

Admin logins fail in the app because they expire after 12 hours, force a password change on first use and are rate limited. Replace each old call:

| Old | New |
| --- | --- |
| `POST /api/auth/login` and a stored token | Remove. Send `X-Device-Key` |
| `POST /api/events` with `vehicleId` | `POST /api/device/crash` with `clientEventId` |
| `PUT /api/events/{id}` | `PATCH /api/device/crash/{id}` |
| `POST /api/sim/{vehicleId}/heartbeat` | `POST /api/device/heartbeat` |
| `GET /api/vehicles/{id}/contacts` | `GET /api/device/me` |

## Troubleshooting

| What you see | What to do |
| --- | --- |
| First call times out, later calls work | The server was asleep. Use a 60 second timeout for the first call |
| `401 invalid_device_key` | Copy the key again and trim it. Check the header is `X-Device-Key`. The key may have been regenerated or revoked |
| `403 password_change_required`, or `401` after about 12 hours | The app is still using an admin login. Use a device key |
| `404 Route not found` | Check the address ends in `/api` and the path starts with `/device/` |
| `429` | Wait for `Retry-After` seconds. Check the app is not looping |
| `CLEARTEXT communication not permitted` | Change `http://` to `https://` |
| `400 invalid_request` | Read the `error` text. It names the problem |
| `warnings` is not empty | The report was saved, but fix the field listed |
| Certificate errors | Check the phone's date and time, then open the address in its browser |

## Getting help

Send the backend owner the vehicle name, time and time zone, request path, HTTP status, and the `error` and `code` values. **Never send the device key.**

For Postman or client generation there is [openapi-device.yaml](openapi-device.yaml). It does not yet list `ref`, `deliveries` or contact `role`, so use this guide for those.
