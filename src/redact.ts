// Best-effort secret redaction for content entering the FTS index.
// Not a PHI control: the ephemeral in-memory index (CONTEXT_MODE_INDEX) is.
const R = "[REDACTED]";

const RULES: Array<[RegExp, string]> = [
  // PEM private key blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, R],
  // Atlassian API tokens
  [/\bATATT3[A-Za-z0-9_\-=]{20,}/g, R],
  // GitHub tokens
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, R],
  // AWS access key ids
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, R],
  // Slack tokens
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, R],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, R],
  // Authorization headers
  [/(\bAuthorization\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s"']+/gi, `$1${R}`],
  // SQL / ADO.NET / Azure connection-string secrets
  [/(\b(?:Password|Pwd)\s*=\s*)("[^"]*"|'[^']*'|[^;'"\s]+)/gi, `$1${R}`],
  [/(\b(?:AccountKey|SharedAccessKey|SharedAccessSignature)\s*=\s*)[^;'"\s]+/gi, `$1${R}`],
  // Credentials embedded in URLs: scheme://user:pass@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${R}@`],
  // JSON "…token|secret|password|api_key…": "value"
  [/("[^"\n]*(?:token|secret|password|passwd|api[_-]?key|private[_-]?key)[^"\n]*"\s*:\s*)"[^"\n]*"/gi, `$1"${R}"`],
  // ENV / ini / yaml style KEY=value or key: value
  [/(\b[A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|_PAT)\b\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, `$1${R}`],
];

export function redactSecrets(text: string): string {
  if (!text || process.env.CONTEXT_MODE_REDACT === "off") return text;
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}
