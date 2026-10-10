import { createClient } from '@blinkdotnew/sdk'

export const blink = createClient({
  projectId: import.meta.env.VITE_BLINK_PROJECT_ID || 'shelly-os-assistant-xm2bru1s',
  publishableKey: import.meta.env.VITE_BLINK_PUBLISHABLE_KEY || 'blnk_pk_kKJYg8CxgLZXkx50ElY0JrD_Hab9sII_',
  authRequired: false,
  auth: { mode: 'managed' },
})
