# Qwen cloud speech for a one-day demonstration

The backend supports Alibaba Cloud's Singapore `qwen3-tts-flash` API. Sentence
generation still uses the existing local model. Only speech synthesis changes.
The API receives the text to speak. API credentials and signed audio URLs are
never returned to the browser. Internet access is required on the server PC.

## Setup

1. Create a pay-as-you-go Model Studio API key in **Singapore**:
   https://www.alibabacloud.com/help/en/model-studio/get-api-key
2. Add these values to the repository root `.env` (ignored by Git):

   ```dotenv
   SPEECH_TTS_PROVIDER=qwen-api
   DASHSCOPE_API_KEY=your-key
   QWEN_API_MODEL=qwen3-tts-flash
   QWEN_API_GIRL_VOICE=Cherry
   QWEN_API_BOY_VOICE=Ethan
   ```

3. Recreate the backend to load its new environment:

   ```powershell
   docker compose up -d --no-deps backend
   ```

4. For the native Windows Vite server, add `VITE_TTS_PROVIDER=qwen-api` to
   `frontend/.env.local`, then restart it with:

   ```powershell
   cd frontend
   npm run dev -- --host 0.0.0.0
   ```

   The Compose frontend receives its setting from the root `.env`; recreate it
   if using that frontend instead of native Vite. Do not put the API key in any
   `VITE_` variable. Refresh each tablet after restarting.

## Behavior and verification

- Online speech uses Qwen API rather than previously bundled Melo/local Qwen
  clips. Offline saved clips remain available and can sound different.
- Cherry and Ethan are built-in system voices, not the project's locally
  designed child voices. Configure voice IDs to change them.
- Qwen returns normal-speed WAV. The browser applies the selected speed while
  playing it. Local workers still apply speed at synthesis time.
- Existing bounded, account-isolated memory caching avoids repeated synthesis
  for the same text, rate and voice for 30 minutes. Restarting the backend clears
  private speech cache. Model and voice settings are included in cache identity.
- Health reports `configured_not_verified` when a key is present. This does not
  prove the key, balance, permissions or API connectivity work. Verify one short
  sentence on the actual tablet. A real request incurs the provider's usage fee.
- Without a key, cloud synthesis fails explicitly; it does not silently use a
  different provider. To restore Melo, set `SPEECH_TTS_PROVIDER=melotts`, remove
  the frontend override, and restart the backend and Vite.

API reference: https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api

Voice list: https://www.alibabacloud.com/help/en/model-studio/qwen-tts-voice-list
