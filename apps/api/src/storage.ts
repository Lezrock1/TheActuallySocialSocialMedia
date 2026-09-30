import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";

const s3 = new S3Client({
  endpoint: env.s3Endpoint,
  region: env.s3Region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
  },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3Bucket }));
  }
}

export function generateMediaKey(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "";
  return `${randomUUID()}${ext ? `.${ext}` : ""}`;
}

export async function putMedia(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getMedia(
  key: string
): Promise<{ body: NodeJS.ReadableStream; contentType: string } | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: env.s3Bucket, Key: key })
    );
    return {
      body: res.Body as NodeJS.ReadableStream,
      contentType: res.ContentType ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function deleteMedia(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
  } catch {
    // best-effort: don't fail the calling request if the object is already gone
  }
}
