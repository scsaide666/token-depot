import "server-only";

export function siteContact(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const operatorName = env.SITE_OPERATOR_NAME?.trim().slice(0, 120) || null;
  const candidate = env.SITE_CONTACT_EMAIL?.trim();
  // A plain address only: no mailto query/header injection or arbitrary URL scheme.
  const email = candidate && candidate.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(candidate) ? candidate : null;
  return { operatorName, email };
}
