import { newId } from "./contracts.ts";
import { openStoreDb } from "./db.ts";
import { decryptSecret, encryptSecret } from "./secret-crypto.ts";

export interface CredentialSummary {
  id: string;
  label: string;
  envName: string;
  botIds: string[];
  createdAt: number;
}
type StoredCredential = Omit<CredentialSummary, "botIds"> & { secret: unknown };

function validEnvName(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
}

export function createCredential(input: { label: string; envName: string; secret: string; botIds: string[] }): CredentialSummary {
  const label = input.label.trim().slice(0, 120);
  const envName = input.envName.trim().toUpperCase();
  if (!label || !validEnvName(envName) || !input.secret) throw new Error("label, a valid ENV_NAME, and secret are required");
  const row: StoredCredential = { id: newId(), label, envName, secret: encryptSecret(input.secret), createdAt: Date.now() };
  const db = openStoreDb();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO credentials (id, label, env_name, created_at, json) VALUES (?, ?, ?, ?, ?)").run(
      row.id, row.label, row.envName, row.createdAt, JSON.stringify(row),
    );
    const grant = db.prepare("INSERT OR IGNORE INTO credential_grants (credential_id, bot_id, created_at) VALUES (?, ?, ?)");
    for (const botId of [...new Set(input.botIds.filter(Boolean))]) grant.run(row.id, botId, Date.now());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { id: row.id, label: row.label, envName: row.envName, botIds: [...new Set(input.botIds.filter(Boolean))], createdAt: row.createdAt };
}

export function listCredentials(): CredentialSummary[] {
  const rows = openStoreDb().prepare("SELECT json FROM credentials ORDER BY created_at DESC").all() as Array<{ json: string }>;
  const grants = openStoreDb().prepare("SELECT credential_id, bot_id FROM credential_grants").all() as Array<{ credential_id: string; bot_id: string }>;
  const byCredential = new Map<string, string[]>();
  for (const grant of grants) byCredential.set(grant.credential_id, [...(byCredential.get(grant.credential_id) ?? []), grant.bot_id]);
  return rows.flatMap((row) => {
    try {
      const stored = JSON.parse(row.json) as StoredCredential;
      return [{ id: stored.id, label: stored.label, envName: stored.envName, createdAt: stored.createdAt, botIds: byCredential.get(stored.id) ?? [] }];
    } catch { return []; }
  });
}

export function setCredentialGrants(id: string, botIds: string[]): CredentialSummary | null {
  const existing = listCredentials().find((row) => row.id === id);
  if (!existing) return null;
  const db = openStoreDb();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM credential_grants WHERE credential_id = ?").run(id);
    const grant = db.prepare("INSERT INTO credential_grants (credential_id, bot_id, created_at) VALUES (?, ?, ?)");
    for (const botId of [...new Set(botIds.filter(Boolean))]) grant.run(id, botId, Date.now());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { ...existing, botIds: [...new Set(botIds.filter(Boolean))] };
}

export function deleteCredential(id: string): boolean {
  return Number(openStoreDb().prepare("DELETE FROM credentials WHERE id = ?").run(id).changes) > 0;
}

export function credentialsForBot(botId: string): CredentialSummary[] {
  return listCredentials().filter((row) => row.botIds.includes(botId));
}

export function revealGrantedCredential(id: string, botId: string): { label: string; envName: string; secret: string } | null {
  const granted = openStoreDb().prepare(
    "SELECT c.json FROM credentials c JOIN credential_grants g ON g.credential_id = c.id WHERE c.id = ? AND g.bot_id = ?",
  ).get(id, botId) as { json: string } | undefined;
  if (!granted) return null;
  try {
    const stored = JSON.parse(granted.json) as StoredCredential;
    const secret = decryptSecret(stored.secret);
    return secret ? { label: stored.label, envName: stored.envName, secret } : null;
  } catch { return null; }
}
