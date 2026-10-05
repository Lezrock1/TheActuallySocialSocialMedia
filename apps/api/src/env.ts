function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

function validateProductionSecret(name: string, value: string): void {
  if (
    nodeEnv === "production" &&
    (value.length < 32 || /^change-me|placeholder|replace-me/i.test(value))
  ) {
    throw new Error(`${name} must be a non-placeholder value of at least 32 characters in production`);
  }
}

const jwtSecret = required("JWT_SECRET");
const aiKeyEncryptionSecret = required("AI_KEY_ENCRYPTION_SECRET");
const bootstrapInviteCode = process.env.BOOTSTRAP_INVITE_CODE;
const webPushPublicKey = process.env.WEB_PUSH_PUBLIC_KEY;
const webPushPrivateKey = process.env.WEB_PUSH_PRIVATE_KEY;
if (Boolean(webPushPublicKey) !== Boolean(webPushPrivateKey)) {
  throw new Error("WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY must be set together");
}
validateProductionSecret("JWT_SECRET", jwtSecret);
validateProductionSecret("AI_KEY_ENCRYPTION_SECRET", aiKeyEncryptionSecret);
if (bootstrapInviteCode) {
  validateProductionSecret("BOOTSTRAP_INVITE_CODE", bootstrapInviteCode);
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret,
  bootstrapInviteCode,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  webPushPublicKey,
  webPushPrivateKey,
  webPushSubject: process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@intouchsocial.com",
  // used to encrypt user-supplied AI provider API keys at rest
  aiKeyEncryptionSecret,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  nodeEnv,
  s3Endpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
  s3Bucket: process.env.S3_BUCKET ?? "media",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "anonymous",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "anonymous",
};
