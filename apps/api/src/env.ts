function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  // used to encrypt user-supplied AI provider API keys at rest
  aiKeyEncryptionSecret: required("AI_KEY_ENCRYPTION_SECRET"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  nodeEnv: process.env.NODE_ENV ?? "development",
  s3Endpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
  s3Bucket: process.env.S3_BUCKET ?? "media",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "anonymous",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "anonymous",
};
