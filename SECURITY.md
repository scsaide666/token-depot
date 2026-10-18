# Security policy

Token Depot is pre-production software. The default branch receives security fixes when available; there is no guaranteed response time or supported production release schedule.

## Report privately

Use this repository's **Security → Report a vulnerability** entry for a private vulnerability report. If that entry is unavailable, open a public issue containing only a request for a private reporting channel. Do not publish an exploit, credentials, user information or a vulnerable deployment address in that issue.

A private report should describe the affected commit, the security boundary involved and the minimum reproduction using an isolated local environment and synthetic data. Do not send actual API keys, passwords, payment private keys, session cookies, database dumps or complete customer prompts/responses.

Test only systems you own or have explicit permission to test. This repository does not authorize tests against the maintainer's accounts, live services or other operators' deployments.

## Operator responsibilities

- Rotate compromised keys at the provider and revoke affected application sessions; removing a value from Git does not invalidate it.
- Keep secrets in ignored local files or runtime secret mounts, never in `NEXT_PUBLIC_*`, image build arguments, screenshots or public issues.
- Keep PostgreSQL and Redis private, preserve fail-closed rate limiting and server-side authorization, and test encrypted backups and restoration.
- Independently review dependencies, container CVEs, wallet settlement and payment verification before any commercial deployment.
- Review [known limitations](docs/open-source-status.md); local Mock tests are not real payment or supplier acceptance.
