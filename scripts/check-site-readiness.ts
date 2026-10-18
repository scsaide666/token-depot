import { config } from "dotenv";
import { paymentOptions } from "../lib/payments/providers/config";
import { siteConfiguration } from "../lib/seo";
import { siteContact } from "../lib/server/site-contact";

config({ path: ".env.local", quiet: true }); config({ quiet: true });
const contact = siteContact();
// Presence/readiness only; never print credentials, private paths or environment contents.
console.log(JSON.stringify({
  indexingEnabled: siteConfiguration().indexable,
  operatorConfigured: Boolean(contact.operatorName), contactConfigured: Boolean(contact.email),
  payments: paymentOptions(),
  providerKeysConfigured: Object.fromEntries(["OPENAI", "ANTHROPIC", "GEMINI", "DEEPSEEK"].map(provider => [provider, Boolean(process.env[`${provider}_API_KEY`])])),
}, null, 2));
